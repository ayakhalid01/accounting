import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Accounting Reconciliation System",
  description: "Financial reconciliation with Odoo invoices integration",
  icons: {
    icon: '/favicon.svg',
    apple: '/favicon.svg',
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{
          __html: `
            console.log('🎨 [CSS] Layout loaded');
            console.log('🎨 [CSS] Document ready state:', document.readyState);
            window.addEventListener('DOMContentLoaded', () => {
              console.log('🎨 [CSS] DOM loaded, checking stylesheets...');
              console.log('🎨 [CSS] Total stylesheets:', document.styleSheets.length);
              for (let i = 0; i < document.styleSheets.length; i++) {
                try {
                  const sheet = document.styleSheets[i];
                  console.log('📄 [CSS] Sheet ' + i + ':', sheet.href || 'inline styles');
                } catch(e) {
                  console.log('⚠️ [CSS] Cannot access sheet ' + i);
                }
              }
            });
          `
        }} />
      </head>
      <body className="antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  )
}
