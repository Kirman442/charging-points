export const MOTORWAY_REVIEW_REASONS = {
  access_exceeds_3km_even_optimistic: 'Подъезд превышает 3 км даже в диагностической сети с ослабленными ограничениями.',
  access_or_snap_review: 'Короткий подъезд найден только при ослабленных ограничениях доступа или привязки к дороге. Нужна проверка.',
  return_or_snap_unconfirmed: 'Подъезд найден, но подходящие возврат и привязка к дороге не подтверждены.',
  topology_or_coordinate_review: 'Нужно проверить связность дорожной сети или координаты площадки.',
  strict_pair_available_diagnostic_only: 'В расширенном окне диагностики найдена пара подъезд/возврат. Исходный статус сохранён до отдельной проверки.',
}

export const motorwayReviewLabel = reason => MOTORWAY_REVIEW_REASONS[reason] || null
