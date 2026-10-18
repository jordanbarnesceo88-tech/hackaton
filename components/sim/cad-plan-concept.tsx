/** Product concept only: never reads a file or changes the calculated geometry. */
export function CadPlanConcept() {
  return <details className="min-w-0 border-t border-border pt-3" data-cad-concept>
    <summary className="tap-target cursor-pointer text-sm font-medium">Загрузить схему · концепт CAD</summary>
    <div className="mt-2 grid max-w-3xl gap-2 text-sm">
      <p>Импорт DWG, DXF и SVG пока не реализован. Эта панель показывает план функции; файл не загружается и текущий расчёт не меняется.</p>
      <ol className="list-decimal space-y-1 pl-5">
        <li>Выбрать файл, единицы и контрольный размер для проверки масштаба.</li>
        <li>Сопоставить слои: стены, препятствия, проходы, доки и зарядные станции.</li>
        <li>Проверить замкнутость контуров, габариты и связность маршрутов на предпросмотре.</li>
        <li>Подтвердить план и выполнить новый серверный расчёт. До подтверждения действует прежняя геометрия.</li>
      </ol>
      <p className="text-xs text-muted-foreground">Сейчас схема строится из параметров объекта; сохранённый проект может содержать явную планировку и граф. Наличие такой структуры данных не означает импорт CAD-файла.</p>
      <a className="w-fit underline" href="/methodology/tz#limitations">Границы модели и дальнейшее развитие</a>
    </div>
  </details>;
}
