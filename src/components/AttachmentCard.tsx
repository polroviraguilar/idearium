import { useEffect, useMemo, useState } from "react";
import { ExternalLink, File, Link2, Music2, Trash2, Video } from "lucide-react";
import type { Attachment } from "../lib/types";
import { formatBytes, mediaEmbed } from "../lib/media";

interface AttachmentCardProps {
  attachment: Attachment;
  onDelete: (id: string) => void;
}

export function AttachmentCard({ attachment, onDelete }: AttachmentCardProps) {
  const [objectUrl, setObjectUrl] = useState<string | undefined>(undefined);
  const embed = useMemo(() => attachment.url ? mediaEmbed(attachment.url) : { type: "none" as const }, [attachment.url]);

  useEffect(() => {
    if (!attachment.blob) return;
    const next = URL.createObjectURL(attachment.blob);
    setObjectUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [attachment.blob]);

  return (
    <article className="attachment-card">
      <div className="attachment-preview">
        {attachment.kind === "image" && objectUrl && (
          <img src={objectUrl} alt={attachment.name} />
        )}
        {attachment.kind === "audio" && objectUrl && (
          <div className="audio-preview">
            <Music2 size={22} />
            <audio src={objectUrl} controls preload="metadata" />
          </div>
        )}
        {attachment.kind === "video" && objectUrl && (
          <video src={objectUrl} controls preload="metadata" />
        )}
        {attachment.kind === "file" && (
          <div className="file-preview"><File size={30} /></div>
        )}
        {attachment.kind === "link" && embed.type === "youtube" && (
          <iframe
            src={embed.url}
            title={attachment.name}
            loading="lazy"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowFullScreen
          />
        )}
        {attachment.kind === "link" && embed.type === "spotify" && (
          <iframe
            src={embed.url}
            title={attachment.name}
            loading="lazy"
            allow="autoplay; clipboard-write; encrypted-media; fullscreen; picture-in-picture"
          />
        )}
        {attachment.kind === "link" && embed.type === "image" && (
          <img src={embed.url} alt={attachment.name} loading="lazy" />
        )}
        {attachment.kind === "link" && embed.type === "none" && (
          <div className="link-preview"><Link2 size={30} /></div>
        )}
      </div>

      <div className="attachment-info">
        <div className="attachment-title">
          {attachment.kind === "video" && <Video size={15} />}
          {attachment.kind === "audio" && <Music2 size={15} />}
          {attachment.kind === "link" && <Link2 size={15} />}
          {attachment.kind === "file" && <File size={15} />}
          <span title={attachment.name}>{attachment.name}</span>
        </div>
        <div className="attachment-actions">
          {attachment.size ? <small>{formatBytes(attachment.size)}</small> : null}
          {attachment.url && (
            <a href={attachment.url} target="_blank" rel="noreferrer" title="Obrir l'enllaç">
              <ExternalLink size={15} />
            </a>
          )}
          <button onClick={() => onDelete(attachment.id)} title="Eliminar adjunt">
            <Trash2 size={15} />
          </button>
        </div>
      </div>
    </article>
  );
}
