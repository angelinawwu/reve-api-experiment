import React, { useEffect, useRef } from "react";
import { ImageGeneration, ImageGenerationHandle } from "img-fx";

const FAKE_IMG = "data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7";

export function GeneratingLoader(props: { className?: string; style?: React.CSSProperties }) {
  const ref = useRef<ImageGenerationHandle>(null);

  useEffect(() => {
    // Start revealing the fake image
    ref.current?.triggerReveal({ hold: "manual" });
    
    // Poll to put it into a boil state so it churns indefinitely
    const interval = setInterval(() => {
      if (ref.current?.isImageActive()) {
        ref.current?.triggerRegenerate({ autoReveal: false });
        clearInterval(interval);
      }
    }, 50);

    return () => clearInterval(interval);
  }, []);

  return (
    <ImageGeneration 
      ref={ref} 
      preset="sweep-gradient" 
      images={[FAKE_IMG]} 
      autoReveal={false}
      style={{ width: "100%", height: "100%", ...props.style }}
      className={props.className}
    >
      <div style={{ width: "100%", height: "100%" }} className={props.className} />
    </ImageGeneration>
  );
}
