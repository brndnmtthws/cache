import * as core from "@actions/core";
import * as cache from "@actions/cache";

import * as custom from "../src/custom/cache";
import { restoreImpl } from "../src/restoreImpl";
import { saveImpl } from "../src/saveImpl";
import { StateProvider } from "../src/stateProvider";
import * as actionUtils from "../src/utils/actionUtils";
import { State } from "../src/constants";

jest.mock("@actions/core");
jest.mock("@actions/cache");
jest.mock("../src/utils/actionUtils");
jest.mock("../src/custom/cache");

describe("Empty Cache Integration Tests", () => {
    let infoSpy: jest.SpyInstance;
    let warningSpy: jest.SpyInstance;
    let setOutputSpy: jest.SpyInstance;

    beforeEach(() => {
        jest.clearAllMocks();

        // Set up S3 environment
        process.env.RUNS_ON_S3_BUCKET_CACHE = "test-bucket";
        process.env.RUNS_ON_AWS_REGION = "us-east-1";
        process.env.ACTIONS_CACHE_URL = "https://api.github.com";
        process.env.GITHUB_REF = "refs/heads/main";

        // Mock action utils
        (actionUtils.isCacheFeatureAvailable as jest.Mock).mockReturnValue(
            true
        );
        (actionUtils.isValidEvent as jest.Mock).mockReturnValue(true);
        (actionUtils.isExactKeyMatch as jest.Mock).mockImplementation(
            (primaryKey: string, restoredKey?: string) =>
                primaryKey === restoredKey
        );
        (actionUtils.getInputAsArray as jest.Mock).mockImplementation(
            (name: string) => {
                if (name === "path") return ["/test/path"];
                if (name === "restore-keys") return [];
                return [];
            }
        );
        (actionUtils.getInputAsBool as jest.Mock).mockReturnValue(false);
        (actionUtils.getInputAsInt as jest.Mock).mockReturnValue(undefined);
        (actionUtils.logWarning as jest.Mock).mockImplementation(
            (message: string) => {
                warningSpy(message);
            }
        );

        // Mock core functions
        infoSpy = jest.spyOn(core, "info").mockImplementation();
        warningSpy = jest.spyOn(core, "warning").mockImplementation();
        jest.spyOn(core, "setFailed").mockImplementation();
        setOutputSpy = jest.spyOn(core, "setOutput").mockImplementation();
        (core.getInput as jest.Mock).mockImplementation((name: string) => {
            if (name === "key") return "test-key";
            return "";
        });
    });

    afterEach(() => {
        delete process.env.RUNS_ON_S3_BUCKET_CACHE;
        delete process.env.RUNS_ON_AWS_REGION;
        delete process.env.ACTIONS_CACHE_URL;
        delete process.env.GITHUB_REF;
    });

    describe("Save Implementation", () => {
        it("should log warning when cache archive is empty (0 bytes)", async () => {
            const stateProvider = new StateProvider();

            // Mock saveCache to throw ValidationError for empty archive
            (custom.saveCache as jest.Mock).mockRejectedValue(
                new Error(
                    "Cache archive is empty (0 bytes). No files were found to cache."
                )
            );

            const result = await saveImpl(stateProvider);

            // saveImpl catches all errors and returns the default cacheId (-1)
            expect(result).toBe(-1);
            expect(actionUtils.logWarning).toHaveBeenCalledWith(
                "Cache archive is empty (0 bytes). No files were found to cache."
            );
        });

        it("should save successfully when cache has content", async () => {
            const stateProvider = new StateProvider();

            // Mock successful save returning cacheId
            (custom.saveCache as jest.Mock).mockResolvedValue(12345);

            const result = await saveImpl(stateProvider);

            expect(result).toBe(12345);
            expect(infoSpy).toHaveBeenCalledWith(
                "Cache saved with key: test-key"
            );
        });

        it("should skip save when primary key matches restored key", async () => {
            const stateProvider = new StateProvider();

            // Mock the state provider methods
            jest.spyOn(stateProvider, "getState").mockImplementation(
                (key: string) => {
                    if (key === State.CachePrimaryKey) return "test-key";
                    return "";
                }
            );
            jest.spyOn(stateProvider, "getCacheState").mockReturnValue(
                "test-key"
            );

            const result = await saveImpl(stateProvider);

            // When cache hit on primary key, saveImpl returns early (undefined)
            expect(result).toBeUndefined();
            expect(infoSpy).toHaveBeenCalledWith(
                "Cache hit occurred on the primary key test-key, not saving cache."
            );
            expect(custom.saveCache).not.toHaveBeenCalled();
        });
    });

    describe("Restore Implementation", () => {
        it("should treat empty cache as cache miss", async () => {
            const stateProvider = new StateProvider();

            // Mock restoreCache to return undefined (cache miss) for empty archive
            (custom.restoreCache as jest.Mock).mockResolvedValue(undefined);

            const result = await restoreImpl(stateProvider);

            expect(result).toBeUndefined();
            expect(infoSpy).toHaveBeenCalledWith(
                "Cache not found for input keys: test-key"
            );
            // cache-hit output should not be set for cache miss
            expect(setOutputSpy).not.toHaveBeenCalledWith("cache-hit", "true");
        });

        it("should restore successfully when cache has valid content", async () => {
            const stateProvider = new StateProvider();

            // Mock successful restore
            (custom.restoreCache as jest.Mock).mockResolvedValue("test-key");

            const result = await restoreImpl(stateProvider);

            expect(result).toBe("test-key");
            expect(infoSpy).toHaveBeenCalledWith(
                "Cache restored from key: test-key"
            );
            expect(setOutputSpy).toHaveBeenCalledWith("cache-hit", "true");
        });

        it("should handle partial key matches", async () => {
            const stateProvider = new StateProvider();

            // Mock restore with different key
            (custom.restoreCache as jest.Mock).mockResolvedValue(
                "test-key-partial"
            );
            (actionUtils.isExactKeyMatch as jest.Mock).mockReturnValue(false);

            const result = await restoreImpl(stateProvider);

            expect(result).toBe("test-key-partial");
            expect(infoSpy).toHaveBeenCalledWith(
                "Cache restored from key: test-key-partial"
            );
            expect(setOutputSpy).toHaveBeenCalledWith("cache-hit", "false");
        });
    });

    describe("End-to-end flow", () => {
        it("should not create cache entry for empty paths", async () => {
            // Simulate save attempt with paths that resolve to empty
            const saveStateProvider = new StateProvider();

            (custom.saveCache as jest.Mock).mockRejectedValue(
                new Error(
                    "Path Validation Error: Path(s) specified in the action for caching do(es) not exist"
                )
            );

            const saveResult = await saveImpl(saveStateProvider);
            expect(saveResult).toBe(-1);
            expect(actionUtils.logWarning).toHaveBeenCalledWith(
                "Path Validation Error: Path(s) specified in the action for caching do(es) not exist"
            );

            // Simulate restore attempt - should find no cache
            const restoreStateProvider = new StateProvider();
            (custom.restoreCache as jest.Mock).mockResolvedValue(undefined);

            const restoreResult = await restoreImpl(restoreStateProvider);
            expect(restoreResult).toBeUndefined();
            expect(infoSpy).toHaveBeenCalledWith(
                "Cache not found for input keys: test-key"
            );
        });
    });
});
