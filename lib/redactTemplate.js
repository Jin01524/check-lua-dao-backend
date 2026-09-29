export function redactTemplateValue(value) {
  if (typeof value === 'string') {
    return value
      .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[đã ẩn email]')
      .replace(/(?<!\d)\d{9,12}(?!\d)/g, '[đã ẩn số liên hệ]')
      .replace(/((?:OTP|mã(?: xác thực| xác minh| OTP)?)\D{0,16})\d{4,8}/gi, '$1[đã ẩn mã]');
  }
  if (Array.isArray(value)) return value.map(redactTemplateValue);
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, redactTemplateValue(item)]));
  }
  return value;
}
