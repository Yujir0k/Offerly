import type { Metadata } from "next";
import { connection } from "next/server";
import "./globals.css";
import "../components/formal-assessment.css";
import "./fsp-auth.css";
import "./email-verification.css";
import "./brand-typography.css";
import "./profile-design.css";
import "./candidate-dashboard.css";
import "./brand-motion.css";
import "./workspace-tour.css";
import "./vacancies.css";
import "./invitations.css";
import "./messages.css";
import "./hiring.css";
import "./workspace-activity.css";
import "./employer-workspace.css";
import "./catalog-polish.css";
import "./employer-matching.css";
import "./mcp.css";
export const metadata: Metadata = {
  title: "Офферли — Дело найдёт.",
  description:
    "Подтвердите навыки и получайте прямые приглашения от работодателей. ИТ-подбор с понятными основаниями и зарплатой до общения.",
  icons: { icon: "/favicon.svg" },
  other: { "codex-preview": "development" },
};
export default async function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  await connection();
  return (
    <html lang="ru" data-scroll-behavior="smooth">
      <body>{children}</body>
    </html>
  );
}
