import React, { useEffect, useRef } from "react";
import { ImageGeneration, ImageGenerationHandle } from "img-fx";

const FAKE_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function GeneratingLoader() {
  const ref = useRef<ImageGenerationHandle>(null);

  useEffect(() => {
    // Start revealing the fake image
    ref.current?.triggerReveal({ hold: "manual" });
    // Immediately put it into a boil state so it churns indefinitely
    const t = setTimeout(() => {
      ref.current?.triggerRegenerate({ autoReveal: false });
    }, 100);
    return () => clearTimeout(t);
  }, []);

  return (
    <ImageGeneration ref={ref} preset="sweep-gradient" images={[FAKE_IMG]} autoReveal={false}>
      <div style={{ width: "100%", height: "100%", background: "transparent" }} />
    </ImageGeneration>
  );
}
