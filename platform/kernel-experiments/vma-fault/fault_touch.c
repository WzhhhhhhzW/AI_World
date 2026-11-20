#define _POSIX_C_SOURCE 200809L
#include <errno.h>
#include <fcntl.h>
#include <inttypes.h>
#include <stdint.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <sys/mman.h>
#include <sys/stat.h>
#include <time.h>
#include <unistd.h>

enum { PAGE_BYTES = 4096, MAX_PAGES = 2048, ROUNDS = 7 };

struct sample {
    unsigned char first;
    unsigned char last;
};

static uint64_t monotonic_ns(void) {
    struct timespec t;
    if (clock_gettime(CLOCK_MONOTONIC, &t) != 0) {
        perror("clock_gettime");
        exit(1);
    }
    return (uint64_t)t.tv_sec * UINT64_C(1000000000) + (uint64_t)t.tv_nsec;
}

static int read_exact(int fd, unsigned char *dst, size_t count, off_t offset) {
    size_t done = 0;
    while (done < count) {
        ssize_t n = pread(fd, dst + done, count - done, offset + (off_t)done);
        if (n < 0 && errno == EINTR) continue;
        if (n < 0) {
            perror("pread");
            return -1;
        }
        if (n == 0) {
            fputs("unexpected end of file\n", stderr);
            return -1;
        }
        done += (size_t)n;
    }
    return 0;
}

int main(int argc, char **argv) {
    static struct sample expected[MAX_PAGES], observed[MAX_PAGES];
    unsigned char page[PAGE_BYTES];
    struct stat st;
    if (argc != 2 || sysconf(_SC_PAGESIZE) != PAGE_BYTES) {
        fputs("Usage on a 4 KiB-page system: fault-touch /absolute/path/to/regular-file\n", stderr);
        return 2;
    }
    int fd = open(argv[1], O_RDONLY);
    if (fd < 0 || fstat(fd, &st) != 0) {
        perror("open/fstat");
        return 1;
    }
    if (!S_ISREG(st.st_mode) || st.st_size < PAGE_BYTES) {
        fputs("input must be a regular file of at least 4096 bytes\n", stderr);
        return 2;
    }
    const off_t available = st.st_size / PAGE_BYTES;
    const size_t pages = available > MAX_PAGES ? MAX_PAGES : (size_t)available;
    const size_t length = pages * PAGE_BYTES;
    for (size_t i = 0; i < pages; ++i) {
        if (read_exact(fd, page, sizeof(page), (off_t)(i * PAGE_BYTES)) != 0) return 1;
        expected[i] = (struct sample){page[0], page[PAGE_BYTES - 1]};
    }
    // Warm the output pages before timing. The file contents above are cache-warm too.
    for (size_t i = 0; i < sizeof(observed); i += PAGE_BYTES)
        ((volatile unsigned char *)observed)[i] = 0;
    ((volatile unsigned char *)observed)[sizeof(observed) - 1] = 0;

    for (unsigned round = 1; round <= ROUNDS; ++round) {
        unsigned char *map = mmap(NULL, length, PROT_READ, MAP_PRIVATE, fd, 0);
        if (map == MAP_FAILED) {
            perror("mmap");
            return 1;
        }
        const volatile unsigned char *view = map;
        uint64_t begin = monotonic_ns();
        for (size_t i = 0; i < pages; ++i) {
            observed[i].first = view[i * PAGE_BYTES];
            observed[i].last = view[(i + 1) * PAGE_BYTES - 1];
        }
        uint64_t elapsed = monotonic_ns() - begin;
        for (size_t i = 0; i < pages; ++i) {
            if (observed[i].first != expected[i].first || observed[i].last != expected[i].last) {
                fprintf(stderr, "data mismatch at round %u page %zu\n", round, i);
                return 1;
            }
        }
        if (munmap(map, length) != 0) {
            perror("munmap");
            return 1;
        }
        printf("FAULT_TOUCH round=%u pages=%zu elapsed_ns=%" PRIu64 "\n", round, pages, elapsed);
    }
    unsigned char *private = mmap(NULL, PAGE_BYTES, PROT_READ | PROT_WRITE, MAP_PRIVATE, fd, 0);
    if (private == MAP_FAILED) {
        perror("mmap private COW check");
        return 1;
    }
    const unsigned char changed = (unsigned char)(expected[0].first ^ 0xff);
    ((volatile unsigned char *)private)[0] = changed;
    if (read_exact(fd, page, 1, 0) != 0) return 1;
    if (page[0] != expected[0].first || ((volatile unsigned char *)private)[0] != changed) {
        fputs("private write isolation failed\n", stderr);
        return 1;
    }
    if (munmap(private, PAGE_BYTES) != 0 || close(fd) != 0) {
        perror("munmap/close");
        return 1;
    }
    puts("FAULT_TOUCH_OK");
    return 0;
}
