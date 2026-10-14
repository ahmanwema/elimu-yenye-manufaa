import { ActionForm } from "@/components/action-form";
import { ClipUploader } from "@/components/clip-uploader";
import { MediaPlayButton } from "@/components/media-play-button";
import { format, type Dictionary } from "@/i18n/dictionaries";
import { cancelMediaDeletionAction, requestMediaDeletionAction, selectCurrentClipAction } from "@/server/actions/media";
import { canRequestMediaDeletion, canSelectCurrentClip, isActiveAuthoringTeacher, type Actor } from "@/server/authz/policy";
import type { CorrectionView } from "@/server/services/corrections";

type Props = { corrections: CorrectionView[]; actor: Actor; dict: Dictionary; locale: string };

/** Human-readable anchor text from its saved snapshot (kept even after the source is removed). */
function anchorText(snapshot: unknown): string {
  if (snapshot && typeof snapshot === "object" && "label" in snapshot && typeof snapshot.label === "string") return snapshot.label;
  return JSON.stringify(snapshot);
}

/**
 * Corrections with their anchors and clip history. Buttons are presentation only: every
 * action and playback URL is re-authorized on the server.
 */
export function CorrectionList({ corrections, actor, dict, locale }: Props) {
  const m = dict.media;
  const dateFmt = new Intl.DateTimeFormat(locale, { dateStyle: "medium" });
  if (corrections.length === 0) return <p className="muted">{m.noCorrections}</p>;
  return (
    <ul className="list">
      {corrections.map((c) => {
        const author = isActiveAuthoringTeacher(actor, c);
        const mayRequestDeletion = canRequestMediaDeletion(actor, c);
        const maySelectCurrent = canSelectCurrentClip(actor, c);
        const liveClips = c.audioClips.filter((x) => x.status === "FINALIZED" && !x.deletedAt);
        const noCurrent = liveClips.length > 0 && !liveClips.some((x) => x.isPrimary);
        return (
          <li key={c.id}>
            <p>
              <strong>
                {format(m.correctionLine, {
                  student: c.student.profile.displayName ?? dict.markaz.unnamed,
                  date: dateFmt.format(c.capturedAt),
                  markaz: c.tenant.name,
                })}
              </strong>
            </p>
            {c.note ? <p>{c.note}</p> : null}
            {c.anchors.map((a) => (
              <p key={a.id} className="muted">
                {m.anchorKinds[a.kind]}: {anchorText(a.snapshot)} {a.sourceRemovedAt ? m.sourceRemoved : null}
              </p>
            ))}
            {noCurrent && maySelectCurrent ? <p className="muted">{m.noCurrent}</p> : null}
            {c.audioClips.length > 0 ? (
              <ul className="list" aria-label={m.clips}>
                {c.audioClips.map((clip) => {
                  const live = clip.status === "FINALIZED" && !clip.deletedAt;
                  const state = clip.deletedAt
                    ? m.clipRemoved
                    : clip.status === "FAILED"
                      ? m.clipFailed
                      : clip.status !== "FINALIZED"
                        ? m.clipPending
                        : clip.isPrimary
                          ? m.primary
                          : m.history;
                  return (
                    <li key={clip.id} className="row">
                      <span>
                        {state}
                        {clip.durationMs !== null && live ? ` — ${Math.round(clip.durationMs / 1000)} s` : null}
                      </span>
                      {live ? <MediaPlayButton kind="clip" id={clip.id} label={m.play} loading={dict.common.loading} results={dict.results} /> : null}
                      {live && mayRequestDeletion && clip.deletionRequests.length === 0 ? (
                        <ActionForm action={requestMediaDeletionAction} submitLabel={m.requestDeletion} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                          <input type="hidden" name="clipId" value={clip.id} />
                        </ActionForm>
                      ) : null}
                      {live && !clip.isPrimary && maySelectCurrent ? (
                        <ActionForm action={selectCurrentClipAction} submitLabel={m.makeCurrent} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                          <input type="hidden" name="correctionId" value={c.id} />
                          <input type="hidden" name="clipId" value={clip.id} />
                        </ActionForm>
                      ) : null}
                      {clip.deletionRequests.length > 0 && !clip.deletedAt ? <span className="muted">{m.deletionPending}</span> : null}
                      {clip.deletionRequests
                        .filter((d) => d.requestedById === actor.profileId)
                        .map((d) => (
                          <ActionForm key={d.id} action={cancelMediaDeletionAction} submitLabel={m.cancelDeletion} pendingLabel={dict.common.loading} messages={dict.results} variant="secondary" inline>
                            <input type="hidden" name="requestId" value={d.id} />
                          </ActionForm>
                        ))}
                    </li>
                  );
                })}
              </ul>
            ) : null}
            {author ? (
              <ClipUploader
                correctionId={c.id}
                strings={{ label: m.uploadClip, submit: m.uploadSubmit, done: m.uploadDone, failed: m.uploadFailed, loading: dict.common.loading, results: dict.results }}
              />
            ) : null}
          </li>
        );
      })}
    </ul>
  );
}
