"use client";
import { Checkbox } from "./ui/checkbox";
export function ResumePhotoReview({
  photos,
  selected,
  onSelect,
}: {
  photos: string[];
  selected: number | null;
  onSelect: (value: number | null) => void;
}) {
  if (!photos.length)
    return (
      <p className="resume-photo-hint">
        Фото не найдено отдельным изображением. Его можно загрузить в «Личные
        данные».
      </p>
    );
  return (
    <section className="resume-photo-review">
      <strong>Фото из резюме</strong>
      <p>
        Проверьте изображение перед переносом. Можно выбрать одно фото или
        оставить текущее.
      </p>
      <div>
        {photos.map((src, index) => (
          <label key={index}>
            <Checkbox
              checked={selected === index}
              onCheckedChange={(checked) => onSelect(checked ? index : null)}
            />
            <img src={src} alt={`Найденное изображение ${index + 1}`} />
            <span>Использовать фото {photos.length > 1 ? index + 1 : ""}</span>
          </label>
        ))}
      </div>
    </section>
  );
}
