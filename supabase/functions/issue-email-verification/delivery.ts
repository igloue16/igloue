export type VerificationEmailDelivery = {
  sendVerificationEmail(input: {
    destination: string;
    verificationUrl: string;
    expiresAt: string;
  }): Promise<{ status: "delivered" | "failed" }>;
};

// Provider-neutral placeholder. It deliberately performs no network I/O.
export const noOpVerificationEmailDelivery: VerificationEmailDelivery = {
  async sendVerificationEmail() {
    return { status: "failed" };
  },
};
