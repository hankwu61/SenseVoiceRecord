/**
 * Gemini API 封裝模組
 * 使用 Google Gemini 2.5 Pro 進行會議摘要與代辦事項提取
 */

const { GoogleGenerativeAI } = require('@google/generative-ai');

let genAI = null;
let model = null;

function initGemini() {
  if (!process.env.GEMINI_API_KEY) {
    console.warn('⚠️  未設定 GEMINI_API_KEY，摘要功能將無法使用');
    return false;
  }
  genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);
  model = genAI.getGenerativeModel({ model: 'gemini-2.5-pro' });
  console.log('✅ Gemini API 初始化完成');
  return true;
}

/**
 * 生成會議摘要與代辦事項
 * @param {string} transcript - 會議逐字稿
 * @param {string} title - 會議標題（可選）
 * @returns {Object} { summary, actionItems }
 */
async function analyzeMeeting(transcript, title = '') {
  if (!model) {
    throw new Error('Gemini API 尚未初始化，請設定 GEMINI_API_KEY');
  }

  const prompt = `你是一位專業的會議記錄助理。請分析以下會議逐字稿，並以 JSON 格式回傳分析結果。

${title ? `會議標題：${title}` : ''}

## 逐字稿內容：
${transcript}

## 請回傳以下 JSON 格式（請確保是合法的 JSON，不要加 markdown 標記）：
{
  "title": "如果未提供標題，請根據內容生成一個簡短的會議標題",
  "summary": {
    "overview": "用 2-3 句話概述會議主要內容",
    "keyPoints": ["重點1", "重點2", "重點3"],
    "decisions": ["決議1", "決議2"]
  },
  "actionItems": [
    {
      "task": "具體的待辦任務描述",
      "owner": "負責人姓名（如無法判斷則寫 '待指派'）",
      "dueDate": "截止日期（如無法判斷則寫 null）",
      "priority": "high / medium / low"
    }
  ]
}

注意事項：
1. 所有內容請使用繁體中文
2. 代辦事項請盡量具體，包含可執行的動作
3. 優先級根據語境和緊急程度判斷
4. 如果逐字稿內容較短或不像正式會議，仍請盡力提取有用資訊`;

  const candidateModels = ['gemini-2.5-flash', 'gemini-1.5-flash', 'gemini-1.5-pro', 'gemini-2.0-flash'];
  let lastError = null;

  for (const modelName of candidateModels) {
    try {
      const m = genAI.getGenerativeModel({ model: modelName });
      const result = await m.generateContent(prompt);
      const response = await result.response;
      let text = response.text();

      // 清理可能的 markdown 包裹
      text = text.replace(/```json\s*/g, '').replace(/```\s*/g, '').trim();
      return JSON.parse(text);
    } catch (err) {
      console.warn(`⚠️ Gemini 模型 ${modelName} 失敗/不可用: ${err.message}`);
      lastError = err;
    }
  }

  console.error('Gemini API 錯誤:', lastError?.message);
  throw new Error(`AI 分析失敗: ${lastError?.message}`);
}

module.exports = { initGemini, analyzeMeeting };
