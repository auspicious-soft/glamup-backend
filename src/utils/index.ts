import { configDotenv } from "dotenv";
import { Request, Response } from "express";
import mongoose, { SortOrder } from "mongoose";
// import { usersModel } from "src/models/user/user-schema";
configDotenv();

const { AWS_REGION, AWS_BUCKET_NAME } = process.env;

export const checkValidAdminRole = (req: Request, res: Response, next: any) => {
  const { role } = req.headers;
  if (role !== "admin") return res.status(403).json({ success: false, message: "Invalid role" });
  else return next();
};
export const checkValidStoreRole = (req: Request, res: Response, next: any) => {
  const { role } = req.headers;
  if (role !== "user") return res.status(403).json({ success: false, message: "Invalid role" });
  else return next();
};

interface Payload {
  description?: string;
  order?: string;
  orderColumn?: string;
}

export const queryBuilder = (payload: Payload, querySearchKeyInBackend = ["name"]) => {
  let { description = "", order = "", orderColumn = "" } = payload;
  const query = description ? { $or: querySearchKeyInBackend.map((key) => ({ [key]: { $regex: description, $options: "i" } })) } : {};
  const sort: { [key: string]: SortOrder } = order && orderColumn ? { [orderColumn]: order === "asc" ? 1 : -1 } : {};

  return { query, sort };
};

export const nestedQueryBuilder = (payload: Payload, querySearchKeyInBackend = ["name"]) => {
  let { description = "", order = "", orderColumn = "" } = payload;

  const queryString = typeof description === "string" ? description : "";

  const query = queryString
    ? {
        $or: querySearchKeyInBackend.flatMap((key) => [
          { [key]: { $regex: queryString, $options: "i" } },
          ...["eng", "kaz", "rus"].map((langKey) => ({
            [`${key}.${langKey}`]: { $regex: queryString, $options: "i" },
          })),
        ]),
      }
    : {};

  const sort: { [key: string]: SortOrder } = order && orderColumn ? { [orderColumn]: order === "asc" ? 1 : -1 } : {};

  return { query, sort };
};

export const toArray = (input: string | string[] | undefined, delimiter: string = ","): string[] => {
  if (!input) return []; // Handle undefined or null input safely
  if (Array.isArray(input)) return input; // If already an array, return as is
  if (typeof input === "string") return input.split(delimiter).map((item) => item.trim()); // Convert comma-separated string to array
  return []; 
};

export const filterBooksByLanguage = (books: any[], languages: string[]): any[] => {
  if (!Array.isArray(books) || books.length === 0) return [];
  if (!Array.isArray(languages) || languages.length === 0) return books; // Return all books if no language filter

  return books.filter((book) => {
    if (book.file instanceof Map) {
      return languages.some((lang) => book.file.has(lang));
    }
    return false;
  });
};

export const sortBooks = (books: any[], sorting: string, languagePriority: string[] = [], appInterface: any): any[] => {
  switch (sorting?.toLowerCase()) {
    case "rating":
      return books.sort((a, b) => (b.averageRating || 0) - (a.averageRating || 0));

    case "alphabetically":
      return books.sort((a, b) => {
        const nameA = getPrimaryLanguageName(a.name, languagePriority, appInterface);
        const nameB = getPrimaryLanguageName(b.name, languagePriority, appInterface);
        return nameA.localeCompare(nameB);
      });

    case "newest":
      return books.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

    case "default":
    default:
      return sortByLanguagePriority(books, "file", languagePriority);
  }
};

const getPrimaryLanguageName = (nameObject: Record<string, string>, languagePriority: string[], appInterface: any): string => {
  for (const lang of languagePriority) {
    if (nameObject[lang]) {
      return nameObject[lang];
    }
  }
  // Fallback: Return the first available name if priority languages are missing
  return Object.values(nameObject)[0] || appInterface;
};

export const sortByLanguagePriority = <T>(items: T[], languageKey: keyof T, preferredLanguages: string[]): T[] => {
  if (!Array.isArray(items) || !preferredLanguages?.length) return items;

  const getFileLanguagePriority = (item: T): number => {
    const fileMap = item[languageKey];

    if (!fileMap || !(fileMap instanceof Map)) return 0;

    const availableLanguages = Array.from(fileMap.keys());

    return preferredLanguages.reduce((count, lang) => count + (availableLanguages.includes(lang) ? 1 : 0), 0);
  };

  return items.sort((a, b) => {
    const priorityA = getFileLanguagePriority(a);
    const priorityB = getFileLanguagePriority(b);

    return priorityB - priorityA;
  });
};

export const applyFilters = (data: any[], query: any, language: string = "eng") => {
  const { minRating = 5, sortBy = "createdAt", sortOrder = "desc" } = query;

  // Filter by minimum average rating
  let filteredData = data.filter((item) => item.averageRating >= parseFloat(minRating));

  // Alphabetical sorting by the book name in the chosen language
  filteredData = filteredData.sort((a, b) => {
    const nameA = a.name[language] || a.name["eng"]; // Default to 'eng' if specific language is unavailable
    const nameB = b.name[language] || b.name["eng"];
    return nameA.localeCompare(nameB);
  });

  // Sorting by the specified field (`sortBy`), default is 'createdAt'
  filteredData = filteredData.sort((a, b) => {
    const dateA = new Date(a[sortBy]).getTime();
    const dateB = new Date(b[sortBy]).getTime();
    return sortOrder === "asc" ? dateA - dateB : dateB - dateA;
  });

  // Filter based on language presence in the name field
  if (language !== "eng") {
    filteredData = filteredData.filter((item) => item.name[language]); // Exclude items without the specified language name
  }

  return filteredData;
};

export const convertToBoolean = (value: string) => {
  if (value === "true") return true;
  else if (value === "false") return false;
  else return value;
};

// export const increaseReferredCountAndCredits = async (id: mongoose.Types.ObjectId) => {
//   await usersModel.findByIdAndUpdate(id, { $inc: { referredCount: 1, creditsLeft: 10 } });
// };
