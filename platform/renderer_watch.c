#define _POSIX_C_SOURCE 200809L
#include <dirent.h>
#include <fcntl.h>
#include <stdio.h>
#include <string.h>
#include <time.h>
#include <unistd.h>

/* Chromium's child argv[0] can be /proc/self/exe on this kernel. */
static int is_renderer(const char *pid) {
    char path[320], command[8192];
    snprintf(path, sizeof(path), "/proc/%s/cmdline", pid);
    int fd = open(path, O_RDONLY);
    if (fd < 0) return 0;
    ssize_t count = read(fd, command, sizeof(command));
    close(fd);
    for (ssize_t start = 0; start < count;) {
        size_t remaining = (size_t)(count - start);
        size_t length = strnlen(command + start, remaining);
        if (length == sizeof("--type=renderer") - 1 &&
            length < remaining && memcmp(command + start, "--type=renderer", length) == 0) {
            return 1;
        }
        start += (ssize_t)length + 1;
    }
    return 0;
}

int main(void) {
    const struct timespec interval = {.tv_nsec = 500000000};
    for (int attempt = 0; attempt < 300; ++attempt) {
        DIR *processes = opendir("/proc");
        if (!processes) { perror("/proc"); return 1; }
        struct dirent *entry;
        while ((entry = readdir(processes)) != NULL) {
            if (entry->d_name[0] < '1' || entry->d_name[0] > '9') continue;
            if (is_renderer(entry->d_name)) {
                printf("FINALS_RENDERER_SEEN_FIRST pid=%s\n", entry->d_name);
                fflush(stdout);
                closedir(processes);
                return 0;
            }
        }
        closedir(processes);
        nanosleep(&interval, NULL);
    }
    return 2;
}
