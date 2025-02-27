import { FormEvent, useEffect, useState } from "react";
import { Calendar, Clock, PlusCircle, Save, Trash } from "lucide-react";
import "./App.css";

type GlucoseUnit = "mg/dL" | "mmol/L";

interface Entry {
  id?: number;
  glucose: number;
  glucoseUnit: GlucoseUnit;
  ketones: number;
  gki: string;
  timestamp: number;
}

const dbName = "GKITrackerDB";
const objectStoreName = "gkiEntries";

const messages = {
  error: {
    invalidInput:
      "Please enter valid glucose and ketone values. Ketones cannot be zero.",
    errorInitializingDatabase: (reason: string) =>
      `Error initializing database: ${reason}`,
    errorDeletingEntry: "Failed to delete entry",
    errorDeletingEntryDetailed: (reason: string) =>
      `Failed to delete entry: ${reason}`,
    errorSavingEntry: "Failed yo save entry",
    errorSavingEntryDetailed: (reason: string) =>
      `Failed to save entry: ${reason}`,
    errorSavingEntryInvalidKeyType: (actualType: string) =>
      `Failed to save entry: expected a number, but got a ${actualType}`,
    failedOpeningDB: "Failed to open database",
    failedRetrievingEntries: "Failed to retrieve entries",
  },
  ketosisZone: {
    deep: "Deep therapeutic ketosis",
    moderate: "Moderate therapeutic ketosis",
    light: "Light nutritional ketosis",
    mild: "Mild ketosis",
    none: "Not in ketosis",
  },
};

function convertGlucoseToMmol(glucose: number, unit: GlucoseUnit) {
  return unit === "mg/dL" ? glucose / 18 : glucose;
}

function assertGlucoseUnit(unit: string): GlucoseUnit {
  if (unit !== "mg/dL" && unit !== "mmol/L") {
    throw new Error(`Invalid glucose unit: ${unit}`);
  }
  return unit;
}

// Calculate GKI
function calculateGKI(
  glucoseValue: number,
  ketonesValue: number,
  unit: GlucoseUnit,
) {
  const glucoseInMmol = convertGlucoseToMmol(glucoseValue, unit);
  return (glucoseInMmol / ketonesValue).toFixed(1);
}

function App() {
  const [glucose, setGlucose] = useState("");
  const [ketones, setKetones] = useState("");
  const [glucoseUnit, setGlucoseUnit] = useState<GlucoseUnit>("mg/dL");
  const [entries, setEntries] = useState<Array<Entry>>([]);
  const [loading, setLoading] = useState(true);
  const [dbError, setDbError] = useState<string | null>(null);

  // Initialize IndexedDB
  useEffect(() => {
    const initDB = async () => {
      try {
        const db = await openDatabase();
        const storedEntries = await getAllEntries(db);
        setEntries(storedEntries.sort((a, b) => b.timestamp - a.timestamp));
        setLoading(false);
      } catch (error: unknown) {
        const reason = error instanceof Error ? error.message : "Unknown error";
        const errorMessage = messages.error.errorInitializingDatabase(reason);
        console.error(errorMessage);
        setDbError(errorMessage);
        setLoading(false);
      }
    };

    initDB();
  }, []);

  // Open IndexedDB database
  function openDatabase(): Promise<IDBDatabase> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(dbName, 1);

      request.onerror = () => {
        reject(new Error(messages.error.failedOpeningDB));
      };

      request.onupgradeneeded = () => {
        const db = request.result;
        if (!db) {
          return; // todo should set the state to db error
        }

        if (!db.objectStoreNames.contains(objectStoreName)) {
          const objectStore = db.createObjectStore(objectStoreName, {
            keyPath: "id",
            autoIncrement: true,
          });
          objectStore.createIndex("timestamp", "timestamp", { unique: false });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };
    });
  }

  // Get all entries from IndexedDB
  const getAllEntries = (db: IDBDatabase): Promise<Entry[]> => {
    return new Promise((resolve, reject) => {
      const transaction = db.transaction([objectStoreName], "readonly");
      const objectStore = transaction.objectStore(objectStoreName);
      const request = objectStore.getAll();

      request.onerror = () => {
        reject(new Error(messages.error.failedRetrievingEntries));
      };

      request.onsuccess = () => {
        const entries = request.result as Entry[];
        resolve(entries);
      };
    });
  };

  // Add entry to IndexedDB
  async function addEntry(entry: Entry): Promise<number> {
    try {
      const db = await openDatabase();
      const transaction = db.transaction([objectStoreName], "readwrite");
      const objectStore = transaction.objectStore(objectStoreName);

      return new Promise((resolve, reject) => {
        const request = objectStore.add(entry);

        request.onerror = () => {
          reject(new Error("Failed to add entry"));
        };

        request.onsuccess = () => {
          const id = request.result;
          if (id === undefined) {
            reject(new Error(messages.error.errorSavingEntry));
          } else if (typeof id !== "number") {
            reject(
              new Error(
                messages.error.errorSavingEntryInvalidKeyType(typeof id),
              ),
            );
          } else {
            resolve(id);
          }
        };
      });
    } catch (error) {
      throw error;
    }
  }

  // Delete entry from IndexedDB
  const deleteEntry = async (id?: number): Promise<void> => {
    if (id === undefined) {
      return;
    }

    try {
      const db = await openDatabase();
      const transaction = db.transaction([objectStoreName], "readwrite");
      const objectStore = transaction.objectStore(objectStoreName);

      return new Promise((resolve, reject) => {
        const request = objectStore.delete(id);

        request.onerror = () => {
          reject(new Error("Failed to delete entry"));
        };

        request.onsuccess = () => {
          resolve();
        };
      });
    } catch (error) {
      throw error;
    }
  };

  // Get GKI zone based on value
  function getGKIZone(
    gki: number,
  ): { zone: keyof typeof messages["ketosisZone"]; color: string } {
    if (gki < 1) {
      return { zone: "deep", color: "bg-purple-500" };
    }
    if (gki >= 1 && gki < 3) {
      return { zone: "moderate", color: "bg-blue-500" };
    }
    if (gki >= 3 && gki < 6) {
      return { zone: "light", color: "bg-green-500" };
    }
    if (gki >= 6 && gki < 9) {
      return { zone: "mild", color: "bg-yellow-500" };
    }
    return { zone: "none", color: "bg-red-500" };
  }

  // Handle form submission
  const handleSubmit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    if (!glucose || !ketones || parseFloat(ketones) === 0) {
      alert(
        messages.error.invalidInput,
      );
      return;
    }

    const glucoseValue = parseFloat(glucose);
    const ketonesValue = parseFloat(ketones);

    const gkiValue = calculateGKI(glucoseValue, ketonesValue, glucoseUnit);

    const newEntry: Entry = {
      glucose: glucoseValue,
      glucoseUnit,
      ketones: ketonesValue,
      gki: gkiValue,
      timestamp: new Date().getTime(),
    };

    try {
      const id = await addEntry(newEntry);
      newEntry.id = id;
      setEntries([newEntry, ...entries]);
      setGlucose("");
      setKetones("");
    } catch (error) {
      console.error("Error adding entry:", error);
      const reason = error instanceof Error ? error.message : "Unknown error";
      alert(messages.error.errorSavingEntryDetailed(reason));
    }
  };

  // Handle entry deletion
  const handleDelete = async (id?: number) => {
    if (id === undefined) {
      return;
    }

    if (!globalThis.confirm("Are you sure you want to delete this entry?")) {
      return;
    }

    try {
      await deleteEntry(id);
      setEntries(entries.filter((entry) => entry.id !== id));
    } catch (error) {
      let errorMessage = messages.error.errorDeletingEntry;
      if (error instanceof Error) {
        errorMessage = messages.error.errorDeletingEntryDetailed(error.message);
      }
      alert(errorMessage);
    }
  };

  // Render loading state
  if (loading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="text-xl">Loading GKI Tracker...</div>
      </div>
    );
  }

  // Render database error
  if (dbError) {
    return (
      <div className="p-4 bg-red-100 text-red-800 rounded">
        <h2 className="text-lg font-bold">Database Error</h2>
        <p>{dbError}</p>
        <p className="mt-2">
          Your browser may not support IndexedDB, or you may be in a private
          browsing mode that restricts data storage.
        </p>
      </div>
    );
  }

  return (
    <div className="max-w-md mx-auto p-4">
      <h1 className="text-2xl font-bold text-center mb-6">
        Glucose-Ketone Index Tracker
      </h1>

      {/* Entry Form */}
      <div className="bg-white p-4 rounded-lg shadow mb-6">
        <h2 className="text-lg font-semibold mb-4">Add New Measurement</h2>
        <form onSubmit={handleSubmit}>
          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">Glucose</label>
            <div className="flex">
              <input
                type="number"
                value={glucose}
                onChange={(e) => setGlucose(e.target.value)}
                className="flex-1 p-2 border rounded-l"
                step="0.1"
                min="0"
                placeholder="Enter glucose level"
                required
              />
              <select
                value={glucoseUnit}
                onChange={(e) =>
                  setGlucoseUnit(assertGlucoseUnit(e.target.value))}
                className="p-2 border border-l-0 rounded-r bg-gray-50"
              >
                <option value="mg/dL">mg/dL</option>
                <option value="mmol/L">mmol/L</option>
              </select>
            </div>
          </div>

          <div className="mb-4">
            <label className="block text-sm font-medium mb-1">
              Ketones (mmol/L)
            </label>
            <input
              type="number"
              value={ketones}
              onChange={(e) => setKetones(e.target.value)}
              className="w-full p-2 border rounded"
              step="0.1"
              min="0.1"
              placeholder="Enter ketone level"
              required
            />
          </div>

          <button
            type="submit"
            className="w-full flex items-center justify-center p-2 bg-blue-600 text-white rounded font-medium hover:bg-blue-700"
          >
            <Save className="w-4 h-4 mr-2" />
            Save Measurement
          </button>
        </form>
      </div>

      {/* History */}
      <div className="bg-white rounded-lg shadow">
        <h2 className="text-lg font-semibold p-4 border-b">
          Measurement History
        </h2>

        {entries.length === 0
          ? (
            <div className="p-6 text-center text-gray-500">
              <div className="flex justify-center mb-2">
                <PlusCircle className="w-8 h-8" />
              </div>
              <p>No measurements recorded yet.</p>
              <p className="text-sm">
                Add your first entry above to get started!
              </p>
            </div>
          )
          : (
            <div className="divide-y">
              {entries.map((entry) => {
                const gkiZone = getGKIZone(parseFloat(entry.gki));

                return (
                  <div key={entry.id} className="p-4">
                    <div className="flex justify-between items-start">
                      <div>
                        <h3 className="font-semibold">GKI: {entry.gki}</h3>
                        <div
                          className={`text-sm inline-block px-2 py-1 rounded-full text-white ${gkiZone.color} mt-1`}
                        >
                          {messages.ketosisZone[gkiZone.zone]}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => handleDelete(entry.id)}
                        className="text-red-500 hover:text-red-700 p-1"
                      >
                        <Trash className="w-4 h-4" />
                      </button>
                    </div>
                    <div className="mt-2 text-sm text-gray-600 flex items-center">
                      <Calendar className="w-4 h-4 mr-1" />
                      {new Date(entry.timestamp).toLocaleDateString()}
                      <Clock className="w-4 h-4 ml-3 mr-1" />
                      {new Date(entry.timestamp).toLocaleTimeString()}
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-sm">
                      <div className="bg-gray-100 p-2 rounded">
                        <span className="text-gray-500">Glucose:</span>{" "}
                        {entry.glucose} {entry.glucoseUnit}
                        {entry.glucoseUnit === "mg/dL" && (
                          <span className="text-gray-500 text-xs">
                            ({convertGlucoseToMmol(
                              entry.glucose,
                              entry.glucoseUnit,
                            ).toFixed(1)} mmol/L)
                          </span>
                        )}
                      </div>
                      <div className="bg-gray-100 p-2 rounded">
                        <span className="text-gray-500">Ketones:</span>{" "}
                        {entry.ketones} mmol/L
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>

      {/* Offline Status Indicator */}
      <div className="mt-4 text-center text-sm text-gray-500">
        <div className="flex items-center justify-center">
          <div
            className={`h-2 w-2 rounded-full mr-2 ${
              navigator.onLine ? "bg-green-500" : "bg-orange-500"
            }`}
          >
          </div>
          {navigator.onLine
            ? "Online - Data will be stored locally"
            : "Offline - Your data is stored locally"}
        </div>
      </div>
    </div>
  );
}

export default App;
