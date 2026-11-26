export type Notice = {
  tone: "success" | "error";
  text: string;
} | null;

export type NotificationAction = "enable" | "save" | "disable";

export type LetterDraft = {
  deliveryPreviewToken?: string;
  expectedUpdatedAt?: string;
  title: string;
  content: string;
  contentFormat: "html";
  deliveryEnabled: boolean;
  inactiveAfterMinutes: string;
  contactUuids: string[];
};

export type ContactDraft = {
  expectedUpdatedAt?: string;
  name: string;
  email: string;
  phone: string;
  note: string;
  letterUuids: string[];
};

export type UserDraft = {
  username: string;
  email: string;
  password: string;
  roleUuid: string;
  avatar: string;
  avatarChanged: boolean;
};

export type UserQuery = {
  page: number;
  pageSize: number;
  keyword: string;
  roleUuid: string;
};

export const emptyLetter: LetterDraft = {
  title: "",
  content: "",
  contentFormat: "html",
  deliveryEnabled: false,
  inactiveAfterMinutes: "",
  contactUuids: [],
};

export const emptyContact: ContactDraft = {
  name: "",
  email: "",
  phone: "",
  note: "",
  letterUuids: [],
};

export const emptyUserDraft: UserDraft = {
  username: "",
  email: "",
  password: "",
  roleUuid: "",
  avatar: "",
  avatarChanged: false,
};
