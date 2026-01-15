
import { GoogleGenAI, Type } from "@google/genai";
import { Subtitle, AssessmentReport } from "../types";

// Create a helper to get the AI instance with the latest key at call time
const getAI = () => new GoogleGenAI({ apiKey: process.env.API_KEY });

const ADULT_CONTEXT_PROMPT = `
  CRITICAL CONTEXT: This recording takes place in an adult chatroom. 
  - Female speakers are professional models. 
  - The user (a single male) is silent and does not speak. 
  - Any male voices heard are background noise from other streams or media playing in the background. 
  - The user has explicit permission to record this session.
  
  SPEAKER IDENTIFICATION RULES:
  - Identify different speakers carefully. 
  - If a name is mentioned (e.g., "Hey Sasha"), use that name.
  - Otherwise, use categorical labels: "Model 1 (F)", "Model 2 (F)", "Background Stream (M)", etc.
  - Determine gender (M/F) based on voice pitch, tone, and linguistic cues (pronouns used by others or self-referential language).
  - Diarize the conversation so that each subtitle segment is attributed to the correct speaker.
`;

export async function transcribeAudio(
  audioBase64: string, 
  startTime: number = 0, 
  enhancedMode: boolean = false,
  adultContext: boolean = false
): Promise<Subtitle[]> {
  const modelName = 'gemini-3-pro-preview'; 
  const ai = getAI();
  
  let basePrompt = `
    You are an expert audio forensic transcriber. Transcribe the following audio accurately.
    Format the output as a list of subtitles with precise timestamps and speaker attribution.
    Consider the start time offset is ${startTime} seconds.
    The output must be a valid JSON array of objects.
    Each object must have 'startTime', 'endTime', 'speaker', and 'text' properties.
    Ensure 'startTime' and 'endTime' are in seconds (float).
    
    RULES:
    1. Only transcribe spoken dialogue. 
    2. DO NOT transcribe singing or background music lyrics.
    3. Include descriptive non-verbal actions in parentheses.
    4. For each segment, identify the 'speaker'. If unknown, use "Speaker 1", "Speaker 2", etc.
  `;

  if (adultContext) {
    basePrompt += `\n${ADULT_CONTEXT_PROMPT}`;
  }

  const enhancedPrompt = `
    SPECIAL INSTRUCTION: Use ADVANCED SPECTRAL ANALYSIS to detect dialogue in whispers or where speech is heavily masked. 
    Focus intensely on speaker separation and identification.
  `;

  const prompt = enhancedMode ? `${basePrompt}\n${enhancedPrompt}` : basePrompt;

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            { text: prompt },
            {
              inlineData: {
                mimeType: 'audio/wav',
                data: audioBase64
              }
            }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              startTime: { type: Type.NUMBER },
              endTime: { type: Type.NUMBER },
              speaker: { type: Type.STRING },
              text: { type: Type.STRING }
            },
            required: ["startTime", "endTime", "text", "speaker"]
          }
        },
        thinkingConfig: { thinkingBudget: enhancedMode ? 8000 : 4000 }
      }
    });

    const jsonStr = response.text;
    if (!jsonStr) throw new Error("No transcription received");
    
    const rawSubs = JSON.parse(jsonStr);
    return rawSubs.map((s: any, index: number) => ({
      ...s,
      id: `sub-${Date.now()}-${index}`
    }));
  } catch (error) {
    console.error("Transcription Error:", error);
    throw error;
  }
}

export async function translateSubtitles(
  subtitles: Subtitle[],
  adultContext: boolean = false
): Promise<Subtitle[]> {
  const modelName = 'gemini-3-pro-preview';
  const ai = getAI();
  
  let prompt = `
    You are a world-class linguistic forensic expert and media localizer. 
    Translate the provided subtitle JSON data into natural, high-impact English. 
    
    CRITICAL TRANSLATION DIRECTIVES:
    1. SLANG & DIALECT: Interpret and translate heavy slang, street vernacular, and idioms accurately.
    2. NUANCE: Detect emotional tone and reflect it in the English choice of words.
    3. STRUCTURE: Return a JSON array. Each object MUST retain its original 'id', 'startTime', 'endTime', and 'speaker'. Only translate the 'text' property.
    4. GENDER & SPEAKER: Maintain the speaker's identity and voice style consistently. Use the provided 'speaker' label to ensure consistency.
  `;

  if (adultContext) {
    prompt += `\n${ADULT_CONTEXT_PROMPT}\nEnsure translation terminology matches the professional adult industry context.`;
  }

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            { text: prompt },
            { text: `JSON DATA TO PROCESS: ${JSON.stringify(subtitles)}` }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.OBJECT,
            properties: {
              id: { type: Type.STRING },
              startTime: { type: Type.NUMBER },
              endTime: { type: Type.NUMBER },
              speaker: { type: Type.STRING },
              text: { type: Type.STRING }
            },
            required: ["id", "startTime", "endTime", "text", "speaker"]
          }
        },
        thinkingConfig: { thinkingBudget: 4000 }
      }
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) throw new Error("No translation response received.");
    
    const translated = JSON.parse(jsonStr);
    if (!Array.isArray(translated)) throw new Error("AI response was not a valid array.");
    
    return translated;
  } catch (error) {
    console.error("Translation Engine Error:", error);
    throw error;
  }
}

export async function analyzeRecordingForensics(
  subtitles: Subtitle[],
  adultContext: boolean = false
): Promise<AssessmentReport> {
  const modelName = 'gemini-3-pro-preview';
  const ai = getAI();
  const transcript = subtitles.map(s => `[${s.startTime.toFixed(2)}s] ${s.speaker || 'Unknown'}: ${s.text}`).join('\n');

  let prompt = `
    You are a Forensic Behavioral Analyst specializing in digital intent.
    Analyze the following transcript for mentions of recording someone.
    
    Specifically address:
    1. RECORDING DETAILS: What is being said about the recording quality, nature, or purpose?
    2. SHARING INTENT: Is there any intent to share this with others or platforms?
    3. SITUATIONAL SUMMARY: Concise summary of dialogue and interaction.
    4. RISK CONTEXT: Any hostile or deceptive recording context?
    
    Return a JSON object with fields: "summary", "recordingDetails", "sharingIntent", "riskContext".
  `;

  if (adultContext) {
    prompt += `\n${ADULT_CONTEXT_PROMPT}\nNote: Permission is granted. Focus on identifying separate streams if male voices are present.`;
  }

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: [
        {
          parts: [
            { text: prompt },
            { text: `TRANSCRIPT:\n${transcript}` }
          ]
        }
      ],
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.OBJECT,
          properties: {
            summary: { type: Type.STRING },
            recordingDetails: { type: Type.STRING },
            sharingIntent: { type: Type.STRING },
            riskContext: { type: Type.STRING }
          },
          required: ["summary", "recordingDetails", "sharingIntent", "riskContext"]
        },
        thinkingConfig: { thinkingBudget: 6000 }
      }
    });

    const jsonStr = response.text?.trim();
    if (!jsonStr) throw new Error("No assessment data returned.");
    return JSON.parse(jsonStr);
  } catch (error) {
    console.error("Forensic Analysis Error:", error);
    throw error;
  }
}

export function convertToSRT(subtitles: Subtitle[]): string {
  const sorted = [...subtitles].sort((a, b) => a.startTime - b.startTime);
  
  return sorted.map((sub, index) => {
    const formatTime = (seconds: number) => {
      const date = new Date(0);
      date.setSeconds(seconds);
      const ms = Math.floor((seconds % 1) * 1000).toString().padStart(3, '0');
      const timeStr = date.toISOString().substr(11, 8);
      return `${timeStr},${ms}`;
    };
    const speakerLabel = sub.speaker ? `${sub.speaker}: ` : '';
    return `${index + 1}\n${formatTime(sub.startTime)} --> ${formatTime(sub.endTime)}\n${speakerLabel}${sub.text}\n`;
  }).join('\n');
}
