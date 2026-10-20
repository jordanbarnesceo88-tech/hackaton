"use client";

import { useEffect, useRef, useState } from "react";
import { Bot, Check, Copy, Download, ExternalLink, X } from "lucide-react";
import { AlfaRobotLogo } from "@/components/brand/alfa-robot-logo";
import { buttonVariants } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { cn } from "@/lib/utils";

/**
 * Вход в платформу управления парком роботов AlfaRobot (отдельный продукт, app.alfa-robots.ru):
 * кнопка в шапке и окно с демо-доступом. Окно повторяет письмо «Вам открыт доступ», которое
 * получает клиент: фиолетовая плашка с логотипом, данные для входа, кнопка «Войти в платформу».
 *
 * Данные для входа публичные: это демо-учётная запись с ролью «Клиент» для жюри и гостей,
 * владелец сам выложил её на сайт. Сменить логин или пароль - здесь, в одном месте.
 *
 * Цвета - из письма, а не из темы сайта: окно - фирменная карточка alfa и одинаково в светлой
 * и тёмной теме (как плашка шапки, только наоборот). Пары проверены на контраст AA:
 * #6B5F88 на #F7F5FF - 5,4:1, #A897FC на #260A5B - 6,7:1.
 */
export const FLEET_PLATFORM = {
  url: "https://app.alfa-robots.ru/",
  login: "hackaton",
  password: "Alfa2026",
  role: "Клиент",
} as const;

const DOWNLOAD_NAME = "AlfaRobot - данные для входа.txt";
const PLATFORM_VIDEO = "/videos/alfa-robot-app.mp4";

const credentialsText = [
  "Платформа управления парком роботов AlfaRobot",
  `Адрес: ${FLEET_PLATFORM.url}`,
  `Логин: ${FLEET_PLATFORM.login}`,
  `Пароль: ${FLEET_PLATFORM.password}`,
  `Роль: ${FLEET_PLATFORM.role}`,
  "",
].join("\n");

/** Буфер обмена есть не везде (http по IP, старые браузеры) - тогда копируем через выделение. */
async function copyText(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const area = document.createElement("textarea");
    area.value = text;
    area.setAttribute("readonly", "");
    area.style.position = "fixed";
    area.style.opacity = "0";
    document.body.append(area);
    area.select();
    try {
      return document.execCommand("copy");
    } catch {
      return false;
    } finally {
      area.remove();
    }
  }
}

function downloadCredentials() {
  const url = URL.createObjectURL(new Blob([credentialsText], { type: "text/plain;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = DOWNLOAD_NAME;
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

type CopyKey = "login" | "password" | "all";

const ROW_LABEL = "text-sm text-[#6B5F88]";
const ICON_BUTTON = cn(
  buttonVariants({ variant: "ghost", size: "icon-sm" }),
  "text-[#6B5F88] hover:text-[#260A5B] aria-expanded:text-[#260A5B]",
);
/** dark:bg-transparent: у outline в тёмной теме своя заливка, а окно всегда светлое. */
const OUTLINE_BUTTON = cn(
  buttonVariants({ variant: "outline", size: "default" }),
  "border-[#E2DCF0] text-[#260A5B] hover:border-[#260A5B] hover:text-[#260A5B] dark:bg-transparent dark:hover:border-[#260A5B]",
);

export function FleetPlatformAccess({ triggerClassName }: { triggerClassName?: string }) {
  const [copied, setCopied] = useState<CopyKey | null>(null);
  const [failed, setFailed] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout>>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  async function copy(key: CopyKey, text: string) {
    const ok = await copyText(text);
    setFailed(!ok);
    setCopied(ok ? key : null);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setCopied(null), 2000);
  }

  const status = failed
    ? "Не удалось скопировать: выделите текст и нажмите Ctrl+C"
    : copied === "login"
      ? "Логин скопирован"
      : copied === "password"
        ? "Пароль скопирован"
        : copied === "all"
          ? "Данные для входа скопированы"
          : "";

  return (
    <Dialog
      onOpenChange={(open) => {
        if (!open) {
          setCopied(null);
          setFailed(false);
        }
      }}
    >
      <DialogTrigger className={triggerClassName}>
        <Bot size={16} aria-hidden={true} />
        {/* Подпись в две строки: в одну («Платформа управления парком роботов», ~300px) шапка
            с xl не помещается в свои 60px по ширине вместе с вкладками и входом. До md - только
            значок, как у «Войти»/«Регистрация» на телефоне; подпись остаётся для скринридера. */}
        <span className="sr-only md:not-sr-only md:max-w-[10.5rem] md:text-left md:leading-tight">
          Платформа управления парком роботов
        </span>
      </DialogTrigger>
      <DialogContent className="max-w-lg overflow-x-hidden overflow-y-auto border-0 bg-white p-0 text-[#1B083F] [color-scheme:light] lg:max-w-[60rem]">
        <div className="flex items-start justify-between gap-4 bg-[#260A5B] px-6 pt-6 pb-5">
          <div className="flex min-w-0 flex-col gap-2.5">
            <AlfaRobotLogo className="h-7 w-auto self-start text-white" />
            <span className="text-xs tracking-wide text-[#A897FC] uppercase">Платформа управления роботами</span>
          </div>
          <DialogClose
            className={cn(buttonVariants({ variant: "ghost", size: "icon-sm" }), "-mt-1 -mr-1.5 text-[#A897FC] hover:text-white")}
          >
            <X aria-hidden={true} />
            <span className="sr-only">Закрыть</span>
          </DialogClose>
        </div>

        <div className="grid gap-6 px-6 pt-5 pb-6 lg:grid-cols-[minmax(0,24rem)_minmax(0,1fr)] lg:items-start">
          <div className="flex min-w-0 flex-col gap-5">
            <div className="flex flex-col gap-2">
              <DialogTitle className="font-heading text-xl font-semibold tracking-normal text-[#1B083F] normal-case">
                Вам открыт доступ
              </DialogTitle>
              <DialogDescription className="text-sm text-[#1B083F]">
                Для вас заведена учётная запись в платформе управления роботами AlfaRobot: состояние парка,
                уведомления, отчёты и задачи.
              </DialogDescription>
            </div>

            <div className="rounded-xl bg-[#F7F5FF] px-4 py-3">
              <p className="border-b border-[#E2DCF0] pb-2 text-xs tracking-wide text-[#6B5F88] uppercase">Данные для входа</p>
              <dl className="divide-y divide-[#E2DCF0]">
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 py-1.5">
                  <dt className={ROW_LABEL}>Логин</dt>
                  <dd className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-mono text-base font-semibold">{FLEET_PLATFORM.login}</span>
                    <button type="button" className={ICON_BUTTON} onClick={() => copy("login", FLEET_PLATFORM.login)}>
                      {copied === "login" ? <Check aria-hidden={true} /> : <Copy aria-hidden={true} />}
                      <span className="sr-only">Скопировать логин</span>
                    </button>
                  </dd>
                </div>
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 py-1.5">
                  <dt className={ROW_LABEL}>Пароль</dt>
                  <dd className="flex min-w-0 items-center justify-between gap-2">
                    <span className="truncate font-mono text-base font-semibold">{FLEET_PLATFORM.password}</span>
                    <button type="button" className={ICON_BUTTON} onClick={() => copy("password", FLEET_PLATFORM.password)}>
                      {copied === "password" ? <Check aria-hidden={true} /> : <Copy aria-hidden={true} />}
                      <span className="sr-only">Скопировать пароль</span>
                    </button>
                  </dd>
                </div>
                <div className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-2 py-2.5">
                  <dt className={ROW_LABEL}>Роль</dt>
                  <dd className="font-semibold">{FLEET_PLATFORM.role}</dd>
                </div>
              </dl>
            </div>

            <div className="flex flex-col gap-1.5">
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  className={OUTLINE_BUTTON}
                  onClick={() => copy("all", `${FLEET_PLATFORM.login}\n${FLEET_PLATFORM.password}\n`)}
                >
                  {copied === "all" ? <Check aria-hidden={true} /> : <Copy aria-hidden={true} />}
                  Скопировать логин и пароль
                </button>
                <button type="button" className={OUTLINE_BUTTON} onClick={downloadCredentials}>
                  <Download aria-hidden={true} />
                  Скачать файлом
                </button>
              </div>
              <p role="status" aria-live="polite" className="min-h-4 text-xs text-[#6B5F88]">
                {status}
              </p>
            </div>

            <div className="flex flex-col gap-2">
              <a
                href={FLEET_PLATFORM.url}
                target="_blank"
                rel="noopener noreferrer"
                className={cn(buttonVariants({ size: "lg" }), "self-start bg-[#260A5B] px-6 text-white hover:bg-[#260A5B]/85")}
              >
                Войти в платформу
                <ExternalLink aria-hidden={true} />
                <span className="sr-only">(откроется в новой вкладке)</span>
              </a>
              <p className="text-xs text-[#6B5F88]">
                или откройте ссылку:{" "}
                <a href={FLEET_PLATFORM.url} target="_blank" rel="noopener noreferrer" className="text-[#260A5B] underline underline-offset-2">
                  app.alfa-robots.ru
                </a>
              </p>
            </div>
          </div>

          {/* Обзор платформы (запись экрана владельца, 1920×1080, 1 мин 45 с, без звука, 35 МБ):
              preload="metadata" - при открытии окна грузятся только заголовок файла и первый кадр,
              сам ролик - по нажатию «Пуск». Окно закрывается - ролик выгружается вместе с ним. */}
          <figure className="flex min-w-0 flex-col gap-2">
            <video
              src={PLATFORM_VIDEO}
              controls
              muted
              playsInline
              preload="metadata"
              aria-label="Видео: как выглядит платформа управления парком роботов AlfaRobot"
              className="aspect-video w-full rounded-lg bg-[#120430]"
            />
            <figcaption className="text-xs text-[#6B5F88]">Как выглядит платформа: обзор за 1 мин 45 с, без звука</figcaption>
          </figure>
        </div>
      </DialogContent>
    </Dialog>
  );
}
