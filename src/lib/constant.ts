export const httpStatusCode = {
  OK: 200,
  CREATED: 201,
  NO_CONTENT: 204,
  BAD_REQUEST: 400,
  UNAUTHORIZED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  INTERNAL_SERVER_ERROR: 500,
};

export const FIXED_GAMES = ["Padel", "Pickleball"] as const;

export const FIXED_FACILITIES = [
  "Free Parking",
  "Paid Parking",
  "Locker Rooms & Changing Area",
  "Rental Equipments",
  "Restrooms & Showers",
] as const;

export const badges = [
  { count: 5, badge: "Saint", level: 1 },
  { count: 10, badge: "Hakim", level: 2 },
  { count: 20, badge: "Genius", level: 3 },
  { count: 25, badge: "Teacher", level: 4 },
  { count: 40, badge: "Sufi", level: 5 },
  { count: 50, badge: "Expert", level: 6 },
  { count: 100, badge: "Commentator", level: 7 },
  { count: 125, badge: "Dervish", level: 8 },
  { count: 150, badge: "Murid", level: 8 },
];

export const priceIdsMap = {
  free: process.env.STRIPE_PRICE_FREE as string,
  intro: process.env.STRIPE_PRICE_INTRO as string,
  pro: process.env.STRIPE_PRICE_PRO as string,
};

export const yearlyPriceIdsMap = {
  intro: process.env.STRIPE_YEARLY_PRICE_INTRO as string,
  pro: process.env.STRIPE_YEARLY_PRICE_PRO as string,
};

export const creditCounts = {
  free: 24,
  intro: 90,
  pro: 180,
};

export const yearlyCreditCounts = {
  intro: 1080,
  pro: 2160,
};
