"use client";

import { useEffect } from "react";

export const ScriptsLoader = () => {
  useEffect(() => {
    const scripts = [
      "/js/jquery.min.js",
      "/js/bootstrap.bundle.min.js",
      "/js/wow.min.js",
      "/js/jquery.isotope.min.js",
      "/js/easing.js",
      "/js/owl.carousel.js",
      "/js/validation.js",
      "/js/jquery.magnific-popup.min.js",
      "/js/enquire.min.js",
      "/js/jquery.plugin.js",
      "/js/jquery.countTo.js",
      "/js/jquery.countdown.js",
      "/js/jquery.lazy.min.js",
      "/js/jquery.lazy.plugins.min.js",
      "/js/mdb.min.js",
      "/js/designesia.js",
    ];

    // Suppress the "t.lazy is not a function" jQuery plugin error that can fire
    // when designesia.js calls $().lazy() before the plugin is fully attached.
    const originalOnError = window.onerror;
    window.onerror = (message, source, lineno, colno, error) => {
      if (
        typeof message === "string" &&
        message.includes("lazy is not a function")
      ) {
        return true; // suppress without crashing
      }
      return originalOnError
        ? (originalOnError as any)(message, source, lineno, colno, error)
        : false;
    };

    let current = 0;
    const loadNext = () => {
      if (current >= scripts.length) {
        // After all scripts are loaded, manually trigger lazy-image init
        // if the plugin attached successfully, so images render properly.
        try {
          const $ = (window as any).jQuery || (window as any).$;
          if ($ && typeof $.fn?.lazy === "function") {
            $("img.lazy").lazy();
          }
        } catch {
          // intentionally suppressed — lazy images are non-critical
        }

        // Trigger synthetic scroll & resize events so WOW.js and layout calculations
        // immediately reveal any above-the-fold elements without requiring manual scroll.
        try {
          window.dispatchEvent(new Event("scroll"));
          window.dispatchEvent(new Event("resize"));
        } catch {
          // ignore
        }
        return;
      }

      const src = scripts[current];
      current++;

      if (document.querySelector(`script[src="${src}"]`)) {
        loadNext();
        return;
      }

      const script = document.createElement("script");
      script.src = src;
      script.onload = loadNext;
      script.onerror = loadNext;
      document.body.appendChild(script);
    };

    loadNext();

    return () => {
      // Restore original error handler on unmount
      window.onerror = originalOnError;
    };
  }, []);

  return null;
};
