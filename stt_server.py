"""
SenseVoice STT Server
使用 FunASR + SenseVoice-Small 模型提供語音轉文字 API
"""

import os
import tempfile
import logging
from flask import Flask, request, jsonify
from flask_cors import CORS
from funasr import AutoModel
from funasr.utils.postprocess_utils import rich_transcription_postprocess
from opencc import OpenCC

# 設定日誌
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')
logger = logging.getLogger(__name__)

app = Flask(__name__)
CORS(app)

# 全域 OpenCC 轉換器 (簡體轉繁體台灣用語)
cc = OpenCC('s2twp')

# 全域模型實例
model = None

def load_model():
    """載入 SenseVoice-Small 模型 + FSMN-VAD 語音切分 + CT-PUNC 標點 + CAM++ 聲紋講者識別"""
    global model
    logger.info("正在載入 SenseVoice-Small、FSMN-VAD、CT-PUNC 與 CAM++ 聲紋辨識模型（CPU 模組）...")
    model = AutoModel(
        model="iic/SenseVoiceSmall",
        vad_model="fsmn-vad",
        punc_model="ct-punc",
        spk_model="cam++",
        vad_kwargs={"max_single_segment_time": 30000},
        trust_remote_code=True,
        device="cpu",
    )
    logger.info("✅ SenseVoice-Small + VAD + PUNC + CAM++ 聲紋辨識模型載入完成！")

@app.route('/health', methods=['GET'])
def health():
    """健康檢查端點"""
    return jsonify({
        "status": "ok",
        "model": "SenseVoice-Small",
        "vad": "fsmn-vad",
        "punc": "ct-punc",
        "spk": "cam++",
        "device": "cpu"
    })

@app.route('/transcribe', methods=['POST'])
def transcribe():
    """
    語音轉文字端點
    接收音檔，回傳帶有講者聲紋分離與時間軸的轉錄文字
    """
    if 'file' not in request.files:
        return jsonify({"error": "未提供音檔，請使用 'file' 欄位上傳"}), 400

    audio_file = request.files['file']
    
    if audio_file.filename == '':
        return jsonify({"error": "檔案名稱為空"}), 400

    # 取得語言參數（可選，預設自動偵測）
    language = request.form.get('language', 'auto')
    
    # 儲存臨時檔案
    suffix = os.path.splitext(audio_file.filename)[1] or '.wav'
    with tempfile.NamedTemporaryFile(delete=False, suffix=suffix) as tmp:
        audio_file.save(tmp.name)
        tmp_path = tmp.name

    try:
        logger.info(f"開始轉錄: {audio_file.filename} (語言: {language})")
        
        # 執行語音辨識（包含 VAD 長語音切片、CAM++ 聲紋切分與講者提取）
        result = model.generate(
            input=tmp_path,
            cache={},
            language=language,
            use_itn=True,
            batch_size_s=60,
            merge_vad=True,
            merge_length_s=15,
        )

        if not result or len(result) == 0:
            return jsonify({"error": "轉錄失敗：無結果"}), 500

        sentence_info = result[0].get("sentence_info", [])
        
        if sentence_info and len(sentence_info) > 0:
            formatted_sentences = []
            current_spk = None
            current_text_segments = []
            start_time_ms = 0

            def format_timestamp(ms):
                sec = int(ms / 1000)
                m = sec // 60
                s = sec % 60
                return f"{m:02d}:{s:02d}"

            for item in sentence_info:
                raw_s = item.get("text", "")
                cleaned_s = rich_transcription_postprocess(raw_s).strip()
                if not cleaned_s:
                    continue
                
                spk_id = item.get("spk", 0)
                try:
                    spk_num = int(spk_id) + 1
                except (ValueError, TypeError):
                    spk_num = 1
                
                spk_label = f"講者 {spk_num}"
                start_ms = item.get("start", 0)
                
                if current_spk is None:
                    current_spk = spk_label
                    start_time_ms = start_ms
                    current_text_segments.append(cleaned_s)
                elif current_spk == spk_label:
                    current_text_segments.append(cleaned_s)
                else:
                    merged_text = "".join(current_text_segments)
                    trad_text = cc.convert(merged_text)
                    formatted_sentences.append(f"[{format_timestamp(start_time_ms)}] {current_spk}：\n{trad_text}")
                    
                    current_spk = spk_label
                    start_time_ms = start_ms
                    current_text_segments = [cleaned_s]

            if current_spk is not None and current_text_segments:
                merged_text = "".join(current_text_segments)
                trad_text = cc.convert(merged_text)
                formatted_sentences.append(f"[{format_timestamp(start_time_ms)}] {current_spk}：\n{trad_text}")

            text = "\n\n".join(formatted_sentences)

        # 降級備援：若 sentence_info 解析為空，退回處理全域 raw_text
        if not text or not text.strip():
            raw_text = result[0].get("text", "")
            cleaned_text = rich_transcription_postprocess(raw_text)
            text = cc.convert(cleaned_text)

        logger.info(f"✅ 轉錄完成（含 CAM++ 講者分離與繁體轉換），文字長度: {len(text)} 字元")

        return jsonify({
            "success": True,
            "text": text,
            "raw": result[0].get("text", ""),
            "language": language
        })

    except Exception as e:
        logger.error(f"❌ 轉錄錯誤: {str(e)}")
        return jsonify({"error": f"轉錄失敗: {str(e)}"}), 500

    finally:
        # 清理臨時檔案
        if os.path.exists(tmp_path):
            os.unlink(tmp_path)

if __name__ == '__main__':
    load_model()
    port = int(os.environ.get('STT_PORT', 5000))
    logger.info(f"🚀 STT 服務啟動在 http://localhost:{port}")
    app.run(host='0.0.0.0', port=port, debug=False)
