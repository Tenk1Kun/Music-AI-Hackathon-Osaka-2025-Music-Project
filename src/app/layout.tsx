import { PropsWithChildren } from "react";
import "./globals.css";

export default function Layout({ children }: PropsWithChildren) {
  return (
    <html>
      <head>
        <title>SurroundSound</title>
      </head>
      <body className="flex flex-col h-screen" cz-shortcut-listen="false">
        <div className="font-semibold uppercase tracking-widest text-3xl bg-zinc-800 pl-2 text-white pt-1">
          <img src="/logo.png" alt="" width={120} />
        </div>

        <div className="flex flex-col justify-center items-center h-full">{children}</div>
      </body>
    </html>
  );
}
