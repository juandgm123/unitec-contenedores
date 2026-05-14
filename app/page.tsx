'use client';

import { useEffect } from 'react';

export default function ContenedoresPage() {
  useEffect(() => {
    // Load external scripts if needed
    const scripts: string[] = [];

    scripts.forEach(src => {
      const script = document.createElement('script');
      script.src = src;
      script.async = true;
      document.body.appendChild(script);
    });
  }, []);

  return (
    <iframe 
      src="/contenedores.html" 
      style={{
        width: '100%',
        height: '100vh',
        border: 'none',
        margin: 0,
        padding: 0
      }}
    />
  );
}
