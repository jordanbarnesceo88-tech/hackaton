import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Имитация склада (lib/sim) обязана давать один и тот же результат в Node (расчёт на сервере
  // при сохранении проекта) и в браузере (проигрывание на экране): вердикт «подтверждён /
  // не подтверждён» и KPI сравниваются бит-в-бит с сохранёнными. Поэтому в ней запрещено всё,
  // что зависит от движка или от момента запуска:
  // - часы (Date, performance): время модели — счётчик шагов, а не настенное время;
  // - Math.random: случайность только от сидируемого генератора (mulberry32);
  // - Math.log: спецификация ECMAScript не требует корректного округления для таких функций,
  //   и движки могут расходиться в последнем бите;
  // - Math.sqrt: по IEEE 754 он округляется корректно, но модель по договорённости плана
  //   обходится abs, + и *, и запрет избавляет от разбора каждого такого случая.
  {
    files: ["lib/sim/**/*.ts"],
    rules: {
      "no-restricted-globals": [
        "error",
        { name: "Date", message: "Имитация детерминирована: время — счётчик шагов модели, а не часы." },
        { name: "performance", message: "Имитация детерминирована: время — счётчик шагов модели, а не часы." },
      ],
      "no-restricted-properties": [
        "error",
        { object: "Math", property: "random", message: "Используйте сидируемый генератор (mulberry32), чтобы Node и браузер совпали." },
        { object: "Math", property: "sqrt", message: "В имитации разрешены только abs, + и *: так результат одинаков во всех движках." },
        { object: "Math", property: "log", message: "Math.log может отличаться между движками в последнем бите; в имитации он запрещён." },
      ],
    },
  },
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
