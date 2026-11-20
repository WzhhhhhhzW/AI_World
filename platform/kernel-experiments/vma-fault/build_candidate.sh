#!/bin/sh
# Local WSL build using the toolchain and registry cache from the verified A kernel.
set -eu

experiment_dir=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
project_dir=$(CDPATH= cd -- "$experiment_dir/../../.." && pwd)
cache_dir="${HOME}/.cache/qilin-kernelbridge/0b6c5960"
source_tar="$project_dir/.git/candidate-source.tar"
patch_file="$experiment_dir/borrow-fault-vma.patch"

export CARGO_HOME="$cache_dir/cargo" RUSTUP_HOME="$cache_dir/rustup"
export RUSTUP_TOOLCHAIN=1.95.0 CARGO_NET_OFFLINE=true
export PATH="$CARGO_HOME/bin:$PATH"

printf '%s  %s\n' c4b8942a27f40d684b0813163a341cdaef4c537558a141c754851f3b213bc420 "$source_tar" \
    30487a5313aa7276a22236c0b76b16bb80b7eac69e600eb0dac37a973451b4ce "$patch_file" | sha256sum -c -
rustc --version
rust-objcopy --version | head -n 1

build_dir=$(mktemp -d "${HOME}/.cache/qilin-kernelbridge/vma-fault.XXXXXXXX")
printf 'Candidate build directory: %s\n' "$build_dir"
mkdir "$build_dir/source"
cd "$build_dir/source"
tar -xf "$source_tar"
git apply --check "$patch_file"
git apply "$patch_file"
cp platforms/kplat-aarch64/qemu_defconfig .config
make defconfig >"$build_dir/defconfig.log" 2>&1 || { tail -n 60 "$build_dir/defconfig.log"; exit 1; }
printf '%s  %s\n' 42e8d16450352712d78813b5f78b7ca221dfb88fadc796f57ecf317d7e33f669 .config | sha256sum -c -
make build >"$build_dir/build.log" 2>&1 || { tail -n 60 "$build_dir/build.log"; exit 1; }

bundle=target/xkmake/kplat-aarch64/release
test -s "$bundle/kernel.bin" && test -s "$bundle/bundle.toml"
result_parent="$project_dir/data/platform/kernel-experiments/vma-fault"
mkdir -p "$result_parent"
result_dir=$(mktemp -d "$result_parent/build.XXXXXXXX")
cp "$bundle/kernel.bin" "$bundle/bundle.toml" .config "$build_dir/defconfig.log" "$build_dir/build.log" "$result_dir/"
(cd "$result_dir" && sha256sum kernel.bin bundle.toml .config >SHA256SUMS)
printf 'Candidate kernel: %s/kernel.bin\n' "$result_dir"
cat "$result_dir/SHA256SUMS"
