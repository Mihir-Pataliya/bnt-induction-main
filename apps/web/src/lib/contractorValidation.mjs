export function validateABN(rawAbn) {
  if (!/^[\d\s-]*$/.test(rawAbn)) return { isValid: false, message: "ABN must contain only digits" };
  const digits = rawAbn.replace(/\D/g, "");
  if (!digits) return { isValid: false, message: "ABN is required" };
  if (!/^\d{11}$/.test(digits)) return { isValid: false, message: "ABN must be exactly 11 numeric digits" };
  const weights = [10, 1, 3, 5, 7, 9, 11, 13, 15, 17, 19];
  const sum = [...digits].reduce((total, digit, index) => total + (Number(digit) - (index === 0 ? 1 : 0)) * weights[index], 0);
  const isValid = sum % 89 === 0;
  return { isValid, message: isValid ? "ABN checksum valid" : "Invalid ABN checksum" };
}

export function validateACN(rawAcn) {
  if (!/^[\d\s-]*$/.test(rawAcn)) return { isValid: false, message: "ACN must contain only digits" };
  const digits = rawAcn.replace(/\D/g, "");
  if (!digits) return { isValid: true, message: "ACN is optional" };
  if (!/^\d{9}$/.test(digits)) return { isValid: false, message: "ACN must be exactly 9 numeric digits" };
  const sum = [...digits.slice(0, 8)].reduce((total, digit, index) => total + Number(digit) * (8 - index), 0);
  const isValid = Number(digits[8]) === (10 - (sum % 10)) % 10;
  return { isValid, message: isValid ? "ACN checksum valid" : "Invalid ACN checksum" };
}
