"use client";

import { useState } from "react";

/**
 * 프로필 사진. avatarImage(예: public/ 에 올린 "/agent.jpg")가 있으면 사진을,
 * 없거나 로드에 실패하면 이모지로 폴백한다.
 */
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
