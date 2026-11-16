import { redirect } from "next/navigation";

// Redirect di halaman ini memang menghasilkan NEXT_REDIRECT; validasi instant
// Next.js tidak boleh memperlakukannya sebagai error development.
export const instant = false;

export default function Home() {
  redirect("/dashboard");
}
