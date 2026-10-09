import type { FilmMachineDuration } from "../../../../shared/production";
import "./production.css";

type Props = {
  durations?: FilmMachineDuration[] | null;
  language: string;
};

const isArabicText = (value: string) => /[\u0600-\u06ff]/.test(value);

function formatTimestamp(value: string, language: string) {
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return "—";
  return new Intl.DateTimeFormat(
    language === "en" ? "en-GB" : "ar-SA-u-ca-gregory-nu-latn",
    {
      dateStyle: "medium",
      timeStyle: "medium",
      timeZone: "Asia/Riyadh",
    },
  ).format(timestamp);
}

function formatDuration(seconds: number, language: string) {
  if (!Number.isFinite(seconds) || seconds < 0) return "—";
  const total = Math.floor(seconds);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const remainingSeconds = total % 60;
  const number = (value: number) => new Intl.NumberFormat(
    language === "en" ? "en-GB" : "ar-SA-u-nu-latn",
    { maximumFractionDigits: 0 },
  ).format(value);

  if (language === "en") {
    const parts = [
      hours > 0 ? `${number(hours)} h` : "",
      minutes > 0 ? `${number(minutes)} min` : "",
      remainingSeconds > 0 || total === 0 ? `${number(remainingSeconds)} sec` : "",
    ].filter(Boolean);
    return parts.join(" ");
  }

  const parts = [
    hours > 0 ? `${number(hours)} س` : "",
    minutes > 0 ? `${number(minutes)} د` : "",
    remainingSeconds > 0 || total === 0 ? `${number(remainingSeconds)} ث` : "",
  ].filter(Boolean);
  return parts.join(" ");
}

function machineName(duration: FilmMachineDuration, language: string) {
  if (language !== "en") {
    return duration.machine_name_ar?.trim() || duration.machine_name?.trim() || duration.machine_id;
  }
  const english = duration.machine_name?.trim() ?? "";
  return english && !isArabicText(english) ? english : duration.machine_id;
}

export function FilmDurationSummary({ durations, language }: Props) {
  const english = language === "en";
  const title = english
    ? "Production duration — first to last roll"
    : "مدة الإنتاج — من أول رول إلى آخر رول";
  const groups = durations ?? [];

  return (
    <section className="prod-film-duration" aria-label={title}>
      <h4>{title}</h4>
      {groups.length === 0 ? (
        <p className="prod-film-duration-empty">
          {english ? "No film machine duration recorded." : "لا توجد مدة مسجلة لماكينة الفيلم."}
        </p>
      ) : (
        <div className="prod-film-duration-list">
          {groups.map((duration) => {
            const hasMultipleRolls = duration.roll_count >= 2;
            const validDuration = duration.duration_seconds !== null &&
              Number.isFinite(duration.duration_seconds) && duration.duration_seconds >= 0;
            return (
              <article className="prod-film-duration-item" key={duration.machine_id}>
                <div className="prod-film-duration-machine">
                  <span>{english ? "Film machine" : "ماكينة الفيلم"}</span>
                  <strong>{machineName(duration, language)}</strong>
                  <small className="prod-number">{duration.machine_id}</small>
                </div>
                <div className="prod-film-duration-value">
                  <span>{english ? "Rolls recorded" : "الرولات المسجلة"}</span>
                  <strong>{new Intl.NumberFormat(english ? "en-GB" : "ar-SA-u-nu-latn", { maximumFractionDigits: 0 }).format(duration.roll_count)}</strong>
                  <p>
                    {duration.roll_count === 0
                      ? (english ? "Duration not recorded." : "المدة غير مسجلة.")
                      : !hasMultipleRolls
                      ? (english ? "One roll; duration not yet determined." : "رول واحد؛ لم تُحدد المدة بعد.")
                      : validDuration
                        ? formatDuration(duration.duration_seconds!, language)
                        : (english ? "Duration not recorded." : "المدة غير مسجلة.")}
                  </p>
                </div>
                <div className="prod-film-duration-times">
                  <div>
                    <span>{english ? "First roll" : "أول رول"}</span>
                    <time dateTime={duration.first_roll_at}>{formatTimestamp(duration.first_roll_at, language)}</time>
                  </div>
                  <div>
                    <span>{english ? "Last roll" : "آخر رول"}</span>
                    <time dateTime={duration.last_roll_at}>{formatTimestamp(duration.last_roll_at, language)}</time>
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
