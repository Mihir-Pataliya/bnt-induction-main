const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const AU_MOBILE_PATTERN = /^(?:\+?61|0)4\d{8}$/;

export function validateBasicProfile(input, { requiresDriverLicence = true, today = new Date().toISOString().slice(0, 10) } = {}) {
  const errors = {};
  const required = [
    ["fullName", "Enter your full legal name."],
    ["email", "Enter a valid email address."],
    ["phone", "Enter a valid mobile number."],
    ["address", "Enter your residential address."],
    ["dateOfBirth", "Enter a valid date of birth."],
    ["emergencyContactName", "Enter an emergency contact name."],
    ["emergencyContactRelationship", "Enter the contact's relationship to you."],
    ["emergencyContactPhone", "Enter a valid emergency contact phone number."]
  ];
  for (const [key, message] of required) {
    if (!String(input[key] ?? "").trim()) errors[key] = message;
  }
  if (String(input.fullName ?? "").trim().length < 2) errors.fullName = "Enter your full legal name.";
  if (!EMAIL_PATTERN.test(String(input.email ?? "").trim())) errors.email = "Enter a valid email address.";
  const phone = String(input.phone ?? "").trim();
  const phoneDigits = phone.replace(/\D/g, "");
  if (!AU_MOBILE_PATTERN.test(phone) && phoneDigits.length !== 10) errors.phone = "Enter a valid mobile number.";
  if (String(input.address ?? "").trim().length < 5) errors.address = "Enter your residential address.";
  const dob = String(input.dateOfBirth ?? "").trim();
  const parsedDob = new Date(`${dob}T00:00:00.000Z`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dob) || Number.isNaN(parsedDob.getTime()) || parsedDob.toISOString().slice(0, 10) !== dob || dob > today) {
    errors.dateOfBirth = "Enter a valid date of birth that is not in the future.";
  }
  const emergencyPhone = String(input.emergencyContactPhone ?? "").trim();
  const emergencyDigits = emergencyPhone.replace(/\D/g, "");
  if (!/^[+\d().\s-]+$/.test(emergencyPhone) || emergencyDigits.length < 8 || emergencyDigits.length > 15) {
    errors.emergencyContactPhone = "Enter a valid phone number (8 to 15 digits).";
  }
  if (requiresDriverLicence && !/^[A-Za-z0-9]{8}$/.test(String(input.licenceNumber ?? "").trim())) {
    errors.licenceNumber = "Licence number must be exactly 8 letters or numbers.";
  }
  return errors;
}
