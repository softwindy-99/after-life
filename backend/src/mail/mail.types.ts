export interface MailConfigStatus {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  configured: boolean;
  missingKeys: string[];
}

export interface UpdateMailConfig {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  password?: string;
  from?: string;
}

export interface SendMailNotification {
  to: string | string[];
  subject: string;
  text?: string;
  html?: string;
}

export interface SendMailResult {
  accepted: string[];
  rejected: string[];
  messageId?: string;
}
