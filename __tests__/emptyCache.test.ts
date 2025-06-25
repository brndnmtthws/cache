import * as core from "@actions/core";

import { restoreCache, saveCache, ValidationError } from "../src/custom/cache";

// Mock the core module
jest.mock("@actions/core");

// Mock fs for file operations
jest.mock("fs", () => ({
    ...jest.requireActual("fs"),
    promises: {
        ...jest.requireActual("fs").promises
    }
}));

describe("Empty Cache Handling", () => {
    beforeEach(() => {
        jest.clearAllMocks();
        // Set up S3 environment
        process.env.RUNS_ON_S3_BUCKET_CACHE = "test-bucket";
        process.env.RUNS_ON_AWS_REGION = "us-east-1";
    });

    afterEach(() => {
        delete process.env.RUNS_ON_S3_BUCKET_CACHE;
        delete process.env.RUNS_ON_AWS_REGION;
    });

    describe("saveCache with empty archives", () => {
        it("should throw ValidationError when archive is 0 bytes", async () => {
            // Mock utils
            const mockUtils = require("@actions/cache/lib/internal/cacheUtils");
            jest.spyOn(mockUtils, "resolvePaths").mockResolvedValue([
                "/some/path/file.txt"
            ]);
            jest.spyOn(mockUtils, "createTempDirectory").mockResolvedValue(
                "/tmp"
            );
            jest.spyOn(mockUtils, "getCacheFileName").mockReturnValue(
                "cache.tar.gz"
            );
            jest.spyOn(mockUtils, "getCompressionMethod").mockResolvedValue(
                "gzip"
            );
            // Mock archive creation resulting in empty file
            jest.spyOn(mockUtils, "getArchiveFileSizeInBytes").mockReturnValue(
                0
            );

            // Mock tar operations
            const mockTar = require("@actions/cache/lib/internal/tar");
            jest.spyOn(mockTar, "createTar").mockResolvedValue(undefined);
            jest.spyOn(mockTar, "listTar").mockResolvedValue(undefined);

            await expect(saveCache(["/some/path"], "test-key")).rejects.toThrow(
                ValidationError
            );

            await expect(saveCache(["/some/path"], "test-key")).rejects.toThrow(
                "Cache archive is empty (0 bytes). No files were found to cache."
            );
        });

        it("should succeed when archive has content", async () => {
            // Mock utils
            const mockUtils = require("@actions/cache/lib/internal/cacheUtils");
            jest.spyOn(mockUtils, "resolvePaths").mockResolvedValue([
                "/some/path/file.txt"
            ]);
            jest.spyOn(mockUtils, "createTempDirectory").mockResolvedValue(
                "/tmp"
            );
            jest.spyOn(mockUtils, "getCacheFileName").mockReturnValue(
                "cache.tar.gz"
            );
            jest.spyOn(mockUtils, "getCompressionMethod").mockResolvedValue(
                "gzip"
            );
            // Mock archive creation with valid size
            jest.spyOn(mockUtils, "getArchiveFileSizeInBytes").mockReturnValue(
                1024
            );

            // Mock tar operations
            const mockTar = require("@actions/cache/lib/internal/tar");
            jest.spyOn(mockTar, "createTar").mockResolvedValue(undefined);
            jest.spyOn(mockTar, "listTar").mockResolvedValue(undefined);

            // Mock backend
            const mockBackend = require("../src/custom/backend");
            jest.spyOn(mockBackend, "saveCache").mockResolvedValue(undefined);

            const result = await saveCache(["/some/path"], "test-key");

            expect(result).toBe(1); // Should return cacheId
            expect(mockBackend.saveCache).toHaveBeenCalled();
        });

        it("should throw error when no paths resolve to actual files", async () => {
            // Mock utils to return empty array after path resolution
            const mockUtils = require("@actions/cache/lib/internal/cacheUtils");
            jest.spyOn(mockUtils, "resolvePaths").mockResolvedValue([]);

            await expect(
                saveCache(["/non/existent/path"], "test-key")
            ).rejects.toThrow(
                "Path Validation Error: Path(s) specified in the action for caching do(es) not exist"
            );
        });
    });

    describe("restoreCache with empty archives", () => {
        it("should treat empty cache (0 bytes) as cache miss", async () => {
            // Mock cache lookup
            const mockBackend = require("../src/custom/backend");
            jest.spyOn(mockBackend, "getCacheEntry").mockResolvedValue({
                cacheKey: "test-key",
                archiveLocation: "https://s3.example.com/cache.tar.gz"
            });

            // Mock download
            jest.spyOn(mockBackend, "downloadCache").mockResolvedValue(
                undefined
            );

            // Mock utils to return 0 file size
            const mockUtils = require("@actions/cache/lib/internal/cacheUtils");
            jest.spyOn(mockUtils, "getArchiveFileSizeInBytes").mockReturnValue(
                0
            );
            jest.spyOn(mockUtils, "createTempDirectory").mockResolvedValue(
                "/tmp"
            );
            jest.spyOn(mockUtils, "getCacheFileName").mockReturnValue(
                "cache.tar.gz"
            );
            jest.spyOn(mockUtils, "getCompressionMethod").mockResolvedValue(
                "gzip"
            );

            const warningSpy = jest.spyOn(core, "warning");

            const result = await restoreCache(["/test/path"], "test-key");

            // Should return undefined indicating cache miss
            expect(result).toBeUndefined();
            expect(warningSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Downloaded cache archive is empty (0 bytes)"
                )
            );
        });

        it("should treat very small cache (< 512 bytes) as cache miss", async () => {
            // Mock cache lookup
            const mockBackend = require("../src/custom/backend");
            jest.spyOn(mockBackend, "getCacheEntry").mockResolvedValue({
                cacheKey: "test-key",
                archiveLocation: "https://s3.example.com/cache.tar.gz"
            });

            // Mock download
            jest.spyOn(mockBackend, "downloadCache").mockResolvedValue(
                undefined
            );

            // Mock utils to return small file size
            const mockUtils = require("@actions/cache/lib/internal/cacheUtils");
            jest.spyOn(mockUtils, "getArchiveFileSizeInBytes").mockReturnValue(
                256 // Less than 512 bytes minimum
            );
            jest.spyOn(mockUtils, "createTempDirectory").mockResolvedValue(
                "/tmp"
            );
            jest.spyOn(mockUtils, "getCacheFileName").mockReturnValue(
                "cache.tar.gz"
            );
            jest.spyOn(mockUtils, "getCompressionMethod").mockResolvedValue(
                "gzip"
            );

            const warningSpy = jest.spyOn(core, "warning");

            const result = await restoreCache(["/test/path"], "test-key");

            // Should return undefined indicating cache miss
            expect(result).toBeUndefined();
            expect(warningSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    "Downloaded cache archive is too small (256 bytes)"
                )
            );
        });

        it("should restore cache successfully with valid size", async () => {
            // Mock cache lookup
            const mockBackend = require("../src/custom/backend");
            jest.spyOn(mockBackend, "getCacheEntry").mockResolvedValue({
                cacheKey: "test-key",
                archiveLocation: "https://s3.example.com/cache.tar.gz"
            });

            // Mock download
            jest.spyOn(mockBackend, "downloadCache").mockResolvedValue(
                undefined
            );

            // Mock utils to return valid file size
            const mockUtils = require("@actions/cache/lib/internal/cacheUtils");
            jest.spyOn(mockUtils, "getArchiveFileSizeInBytes").mockReturnValue(
                2048 // Valid size
            );
            jest.spyOn(mockUtils, "createTempDirectory").mockResolvedValue(
                "/tmp"
            );
            jest.spyOn(mockUtils, "getCacheFileName").mockReturnValue(
                "cache.tar.gz"
            );
            jest.spyOn(mockUtils, "getCompressionMethod").mockResolvedValue(
                "gzip"
            );

            // Mock tar extraction
            const mockTar = require("@actions/cache/lib/internal/tar");
            jest.spyOn(mockTar, "extractTar").mockResolvedValue(undefined);
            jest.spyOn(mockTar, "listTar").mockResolvedValue(undefined);

            const infoSpy = jest.spyOn(core, "info");

            const result = await restoreCache(["/test/path"], "test-key");

            // Should return the cache key on success
            expect(result).toBe("test-key");
            expect(infoSpy).toHaveBeenCalledWith("Cache restored successfully");
        });
    });

    describe("Edge cases", () => {
        it("should handle tar archives with only headers (no content)", async () => {
            // A tar file with just headers would be exactly 512 bytes or a multiple
            const mockUtils = require("@actions/cache/lib/internal/cacheUtils");
            jest.spyOn(mockUtils, "getArchiveFileSizeInBytes").mockReturnValue(
                512 // Exactly one tar block with just headers
            );
            jest.spyOn(mockUtils, "createTempDirectory").mockResolvedValue(
                "/tmp"
            );
            jest.spyOn(mockUtils, "getCacheFileName").mockReturnValue(
                "cache.tar.gz"
            );
            jest.spyOn(mockUtils, "getCompressionMethod").mockResolvedValue(
                "gzip"
            );

            // For restore: should be allowed as it passes minimum size check
            const mockBackend = require("../src/custom/backend");
            jest.spyOn(mockBackend, "getCacheEntry").mockResolvedValue({
                cacheKey: "test-key",
                archiveLocation: "https://s3.example.com/cache.tar.gz"
            });
            jest.spyOn(mockBackend, "downloadCache").mockResolvedValue(
                undefined
            );

            const mockTar = require("@actions/cache/lib/internal/tar");
            jest.spyOn(mockTar, "extractTar").mockResolvedValue(undefined);
            jest.spyOn(mockTar, "listTar").mockResolvedValue(undefined);

            const result = await restoreCache(["/test/path"], "test-key");
            expect(result).toBe("test-key"); // Should succeed
        });

        it("should handle corrupted downloads that result in 0 bytes", async () => {
            // Mock a download that completes but results in empty file
            const mockBackend = require("../src/custom/backend");
            jest.spyOn(mockBackend, "getCacheEntry").mockResolvedValue({
                cacheKey: "test-key",
                archiveLocation: "https://s3.example.com/cache.tar.gz"
            });

            // Mock download completing successfully
            jest.spyOn(mockBackend, "downloadCache").mockResolvedValue(
                undefined
            );

            // But file size check shows 0 bytes
            const mockUtils = require("@actions/cache/lib/internal/cacheUtils");
            jest.spyOn(mockUtils, "getArchiveFileSizeInBytes").mockReturnValue(
                0
            );
            jest.spyOn(mockUtils, "createTempDirectory").mockResolvedValue(
                "/tmp"
            );
            jest.spyOn(mockUtils, "getCacheFileName").mockReturnValue(
                "cache.tar.gz"
            );
            jest.spyOn(mockUtils, "getCompressionMethod").mockResolvedValue(
                "gzip"
            );

            const warningSpy = jest.spyOn(core, "warning");

            const result = await restoreCache(["/test/path"], "test-key");

            expect(result).toBeUndefined(); // Cache miss
            expect(warningSpy).toHaveBeenCalledWith(
                expect.stringContaining(
                    "may indicate a failed download or corrupted cache"
                )
            );
        });
    });
});
