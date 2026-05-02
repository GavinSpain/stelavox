import { redirect } from "next/navigation";

export default function RootPage() {
  // Root redirects to login; auth middleware will redirect to dashboard if signed in
  redirect("/login");
}
