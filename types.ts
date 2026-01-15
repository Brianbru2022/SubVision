
export interface Subtitle {
  id: string;
  startTime: number; // in seconds
  endTime: number; // in seconds
  text: string;
  speaker?: string;
}

export interface ProcessingStatus {
  step: 'idle' | 'extracting-audio' | 'detecting-speech' | 'generating-srt' | 'baking' | 'exporting-chunks' | 'complete' | 'assessing';
  progress: number;
  message: string;
}

export interface VideoMetadata {
  name: string;
  duration: number;
  size: number;
  type: string;
}

export interface AssessmentReport {
  summary: string;
  recordingDetails: string;
  sharingIntent: string;
  riskContext: string;
}
