export type SupportedLocale = "fr" | "en";

export type EmailAddress = {
  address: string;
  name?: string;
};

export type TransactionalEmailMessage = {
  template: string;
  locale: SupportedLocale;
  from: EmailAddress;
  to: EmailAddress;
  subject: string;
  textBody: string;
  htmlBody: string;
};
