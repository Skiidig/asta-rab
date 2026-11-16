/** Turn an unknown thrown value into a message safe to show in the UI. */
export function toErrorMessage(
  error: unknown,
  fallback = "Terjadi kesalahan yang tidak diketahui.",
) {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === "string" && error.trim()) return error;

  if (typeof error === "object" && error !== null && "message" in error) {
    const message = (error as { message?: unknown }).message;
    if (typeof message === "string" && message.trim()) return message;
  }

  return fallback;
}
