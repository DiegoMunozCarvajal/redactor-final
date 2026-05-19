import { Navbar } from "@/components/patterns/navbar";
import { CommandPalette } from "@/components/patterns/command-palette";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { ThemeProvider } from "next-themes";
import { Toaster } from "sonner";
import "./globals.css";

const meslo = localFont({
  src: [
    { path: "../fonts/MesloLGS-NF-Regular.ttf", weight: "400", style: "normal" },
    { path: "../fonts/MesloLGS-NF-Italic.ttf", weight: "400", style: "italic" },
    { path: "../fonts/MesloLGS-NF-Bold.ttf", weight: "700", style: "normal" },
    { path: "../fonts/MesloLGS-NF-Bold-Italic.ttf", weight: "700", style: "italic" },
  ],
  variable: "--font-meslo",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Redactor",
  description: "Genera libros de no-ficción en español",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="es"
      suppressHydrationWarning
      className={`${meslo.variable}`}
    >
      <body className="bg-background text-foreground">
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <Navbar />
          <main className="min-h-screen">{children}</main>
          <Toaster />
          <CommandPalette />
        </ThemeProvider>
      </body>
    </html>
  );
}
