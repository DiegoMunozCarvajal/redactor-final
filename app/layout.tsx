import { Navbar } from "@/components/patterns/navbar";
import { Sidebar } from "@/components/patterns/sidebar";
import { CommandPalette } from "@/components/patterns/command-palette";
import type { Metadata } from "next";
import localFont from "next/font/local";
import { Lora } from "next/font/google";
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

const lora = Lora({
  subsets: ["latin"],
  variable: "--font-lora",
  display: "swap",
});

// Geist Sans loaded from npm geist package
const geistSans = localFont({
  src: [
    {
      path: "../node_modules/geist/dist/fonts/geist-sans/Geist-Regular.woff2",
      weight: "400",
      style: "normal",
    },
    {
      path: "../node_modules/geist/dist/fonts/geist-sans/Geist-Medium.woff2",
      weight: "500",
      style: "normal",
    },
    {
      path: "../node_modules/geist/dist/fonts/geist-sans/Geist-SemiBold.woff2",
      weight: "600",
      style: "normal",
    },
    {
      path: "../node_modules/geist/dist/fonts/geist-sans/Geist-Bold.woff2",
      weight: "700",
      style: "normal",
    },
  ],
  variable: "--font-geist-sans",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Redactor",
  description: "Generates non-fiction books in Spanish",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${meslo.variable} ${lora.variable} ${geistSans.variable}`}
    >
      <body className="bg-background text-foreground">
        <script
          dangerouslySetInnerHTML={{
            __html: `try{var d=localStorage.getItem("ui-density");if(d==="compact"){document.documentElement.classList.add("density-compact")}}catch(e){}`,
          }}
        />
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem>
          <div className="flex min-h-screen">
            <Sidebar />
            <div className="flex-1 flex flex-col min-w-0">
              <Navbar />
              <main className="flex-1 w-full px-6">
                {children}
              </main>
            </div>
          </div>
          <Toaster />
          <CommandPalette />
        </ThemeProvider>
      </body>
    </html>
  );
}
