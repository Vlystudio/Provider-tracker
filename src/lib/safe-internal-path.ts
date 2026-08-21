const controlCharacters = /[\u0000-\u001f\u007f]/;

export function isSafeInternalPath(value: string): boolean {
  return value.length >= 1
    && value.length <= 512
    && value.startsWith('/')
    && !value.startsWith('//')
    && !value.includes('\\')
    && !controlCharacters.test(value);
}
