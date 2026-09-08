import { Suspense } from "react";
import { WizardChrome } from "@/components/wizard/wizard-chrome";
import { StepTransition } from "@/components/wizard/step-transition";

/**
 * Route group `(wizard)` не влияет на URL — она даёт только эту оболочку. Благодаря этому
 * /compare/[type] и /calculate/[solutionId] остались собой, а сохранённые расчёты и уже
 * разосланные отчёты продолжают открываться по своим ссылкам.
 */
export default function WizardLayout({ children }: { children: React.ReactNode }) {
  return (
    <>
      {/* useSearchParams требует границы Suspense, иначе страница целиком уходит в
          клиентский рендер и теряет серверную отрисовку. */}
      <Suspense fallback={null}>
        <WizardChrome />
      </Suspense>
      <StepTransition>{children}</StepTransition>
    </>
  );
}
