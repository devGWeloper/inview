"use client";

import { useState } from "react";

export function AgentAvatar({ image, emoji }: { image: string; emoji: string }) {
  const [failed, setFailed] = useState(false);
  const showImage = image.trim() !== "" && !failed;

  return (
    <div className={"agent-avatar" + (showImage ? " has-image" : "")} aria-hidden>
      {showImage ? (
        <img src={image} alt="" onError={() => setFailed(true)} />
      ) : (
        <span className="agent-avatar-emoji">{emoji}</span>
      )}
    </div>
  );
}
