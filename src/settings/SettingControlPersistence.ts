export interface SettingValueControl<T> {
  setValue(value: T): unknown;
}

export async function commitControlValue<TModel, TDisplay>(
  control: SettingValueControl<TDisplay>,
  previous: TModel,
  next: TModel,
  display: (value: TModel) => TDisplay,
  persist: (value: TModel) => Promise<boolean>,
): Promise<boolean> {
  control.setValue(display(next));
  let saved = false;
  try { saved = await persist(next); } catch { saved = false; }
  if (!saved) control.setValue(display(previous));
  return saved;
}
