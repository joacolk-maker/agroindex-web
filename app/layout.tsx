import type { Metadata } from 'next';
import Script from 'next/script';
import './globals.css';

const measurementId = 'G-LWXTFCXK3L';

export const metadata: Metadata = {
  metadataBase: new URL('https://agroindex.cl/'),
  title: 'AgroIndex | Más información. Mejor decisión.',
  description: 'Información mayorista clara y comparable de frutas y hortalizas en Chile.',
  openGraph: {
    title: 'AgroIndex | Más información. Mejor decisión.',
    description: 'Información mayorista clara y comparable de frutas y hortalizas en Chile.',
    images: [{ url: '/og.png', width: 1672, height: 941, alt: 'AgroIndex: más información, mejores decisiones.' }],
  },
  twitter: {
    card: 'summary_large_image',
    title: 'AgroIndex | Más información. Mejor decisión.',
    description: 'Información mayorista clara y comparable de frutas y hortalizas en Chile.',
    images: ['/og.png'],
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body>
        {children}
        <Script
          src={`https://www.googletagmanager.com/gtag/js?id=${measurementId}`}
          strategy="afterInteractive"
        />
        <Script
          id="google-analytics"
          strategy="afterInteractive"
          dangerouslySetInnerHTML={{
            __html: `
              window.dataLayer = window.dataLayer || [];
              function gtag(){window.dataLayer.push(arguments);}
              gtag('js', new Date());
              gtag('config', '${measurementId}');
            `,
          }}
        />
      </body>
    </html>
  );
}
