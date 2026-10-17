cmake_minimum_required(VERSION 3.21)

cmake_policy(SET CMP0091 NEW)
project(ycode_native_ugrep LANGUAGES C CXX)

if(NOT MSVC)
  message(FATAL_ERROR "YCode Windows ugrep must be built with MSVC")
endif()

foreach(source_name UGREP PCRE2 ZLIB BZIP2 ZSTD BROTLI)
  if(NOT DEFINED YCODE_${source_name}_SOURCE_DIR)
    message(FATAL_ERROR "Missing YCODE_${source_name}_SOURCE_DIR")
  endif()
endforeach()

if(NOT DEFINED YCODE_UGREP_OUTPUT_DIR)
  message(FATAL_ERROR "Missing YCODE_UGREP_OUTPUT_DIR")
endif()

set(CMAKE_MSVC_RUNTIME_LIBRARY "MultiThreaded$<$<CONFIG:Debug>:Debug>")
set(BUILD_SHARED_LIBS OFF CACHE BOOL "" FORCE)
set(BUILD_TESTING OFF CACHE BOOL "" FORCE)

# 随机构建目录不能进入最终 PE，否则同版本工具无法跨 CLI 复用同一份 runtime cache。
if(DEFINED YCODE_BUILD_PATH)
  add_compile_options("/pathmap:${YCODE_BUILD_PATH}=ycode-native-search")
endif()

set(BUILD_STATIC_LIBS ON CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_8 ON CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_16 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2_32 OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_PCRE2GREP OFF CACHE BOOL "" FORCE)
set(PCRE2_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(PCRE2_SHOW_REPORT OFF CACHE BOOL "" FORCE)
set(PCRE2_STATIC_RUNTIME ON CACHE BOOL "" FORCE)
set(PCRE2_SUPPORT_JIT ON CACHE BOOL "" FORCE)
add_subdirectory("${YCODE_PCRE2_SOURCE_DIR}" pcre2 EXCLUDE_FROM_ALL)

set(SKIP_INSTALL_ALL ON CACHE BOOL "" FORCE)
add_subdirectory("${YCODE_ZLIB_SOURCE_DIR}" zlib EXCLUDE_FROM_ALL)

add_library(ycode_bzip2 STATIC
  "${YCODE_BZIP2_SOURCE_DIR}/blocksort.c"
  "${YCODE_BZIP2_SOURCE_DIR}/huffman.c"
  "${YCODE_BZIP2_SOURCE_DIR}/crctable.c"
  "${YCODE_BZIP2_SOURCE_DIR}/randtable.c"
  "${YCODE_BZIP2_SOURCE_DIR}/compress.c"
  "${YCODE_BZIP2_SOURCE_DIR}/decompress.c"
  "${YCODE_BZIP2_SOURCE_DIR}/bzlib.c"
)
target_compile_definitions(ycode_bzip2 PRIVATE _CRT_SECURE_NO_WARNINGS)
target_include_directories(ycode_bzip2 PUBLIC "${YCODE_BZIP2_SOURCE_DIR}")

set(ZSTD_BUILD_CONTRIB OFF CACHE BOOL "" FORCE)
set(ZSTD_BUILD_PROGRAMS OFF CACHE BOOL "" FORCE)
set(ZSTD_BUILD_SHARED OFF CACHE BOOL "" FORCE)
set(ZSTD_BUILD_STATIC ON CACHE BOOL "" FORCE)
set(ZSTD_BUILD_TESTS OFF CACHE BOOL "" FORCE)
set(ZSTD_USE_STATIC_RUNTIME ON CACHE BOOL "" FORCE)
add_subdirectory("${YCODE_ZSTD_SOURCE_DIR}/build/cmake" zstd EXCLUDE_FROM_ALL)

set(BROTLI_BUNDLED_MODE ON CACHE BOOL "" FORCE)
add_subdirectory("${YCODE_BROTLI_SOURCE_DIR}" brotli EXCLUDE_FROM_ALL)

set(YCODE_VIIZ_SOURCE_DIR "${YCODE_UGREP_SOURCE_DIR}/lzma/C")
add_library(ycode_viiz STATIC
  "${YCODE_VIIZ_SOURCE_DIR}/viizip.c"
  "${YCODE_VIIZ_SOURCE_DIR}/7zAlloc.c"
  "${YCODE_VIIZ_SOURCE_DIR}/7zArcIn.c"
  "${YCODE_VIIZ_SOURCE_DIR}/7zBuf.c"
  "${YCODE_VIIZ_SOURCE_DIR}/7zBuf2.c"
  "${YCODE_VIIZ_SOURCE_DIR}/7zCrc.c"
  "${YCODE_VIIZ_SOURCE_DIR}/7zCrcOpt.c"
  "${YCODE_VIIZ_SOURCE_DIR}/7zDec.c"
  "${YCODE_VIIZ_SOURCE_DIR}/7zFile.c"
  "${YCODE_VIIZ_SOURCE_DIR}/7zStream.c"
  "${YCODE_VIIZ_SOURCE_DIR}/Bcj2.c"
  "${YCODE_VIIZ_SOURCE_DIR}/Bra.c"
  "${YCODE_VIIZ_SOURCE_DIR}/Bra86.c"
  "${YCODE_VIIZ_SOURCE_DIR}/BraIA64.c"
  "${YCODE_VIIZ_SOURCE_DIR}/CpuArch.c"
  "${YCODE_VIIZ_SOURCE_DIR}/Delta.c"
  "${YCODE_VIIZ_SOURCE_DIR}/Lzma2Dec.c"
  "${YCODE_VIIZ_SOURCE_DIR}/LzmaDec.c"
  "${YCODE_VIIZ_SOURCE_DIR}/Ppmd7.c"
  "${YCODE_VIIZ_SOURCE_DIR}/Ppmd7Dec.c"
)
target_compile_definitions(ycode_viiz PRIVATE
  Z7_PPMD_SUPPORT
  Z7_EXTRACT_ONLY
  NDEBUG
  _CRT_SECURE_NO_WARNINGS
)
target_include_directories(ycode_viiz PUBLIC "${YCODE_VIIZ_SOURCE_DIR}")

set(YCODE_REFLEX_SOURCES
  "${YCODE_UGREP_SOURCE_DIR}/lib/block_scripts.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/composer.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/convert.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/debug.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/error.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/input.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/language_scripts.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/letter_case.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/letter_scripts.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/matcher.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/pattern.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/posix.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/simd.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/unicode.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/lib/utf8.cpp"
)

add_library(ycode_reflex STATIC ${YCODE_REFLEX_SOURCES})
target_compile_definitions(ycode_reflex PRIVATE WITH_NO_CODEGEN)

add_executable(ugrep
  "${YCODE_UGREP_SOURCE_DIR}/src/ugrep.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/src/cnf.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/src/glob.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/src/output.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/src/query.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/src/screen.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/src/stats.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/src/vkey.cpp"
  "${YCODE_UGREP_SOURCE_DIR}/src/zopen.c"
)

add_library(ycode_ugrep_contract INTERFACE)
target_compile_definitions(ycode_ugrep_contract INTERFACE
  HAVE_LIBBROTLI
  HAVE_LIBBZ2
  HAVE_LIBZ
  HAVE_LIBZSTD
  HAVE_PCRE2
  NDEBUG
  PCRE2_STATIC
  WITH_COLOR
  WITH_NO_INDENT
  _CONSOLE
  _CRT_NONSTDC_NO_WARNINGS
  _CRT_SECURE_NO_WARNINGS
)
if(CMAKE_GENERATOR_PLATFORM STREQUAL "ARM64")
  target_compile_definitions(ycode_ugrep_contract INTERFACE HAVE_NEON)
else()
  target_compile_definitions(ycode_ugrep_contract INTERFACE HAVE_SSE2)
endif()
target_compile_features(ycode_ugrep_contract INTERFACE cxx_std_17)
# ugrep 固定源码是无 BOM UTF-8；中文 Windows 按 CP936 解析时会触发 C4819/C1070，并改写 UTF-8 字符串字面量。
target_compile_options(ycode_ugrep_contract INTERFACE
  /utf-8
  $<$<COMPILE_LANGUAGE:CXX>:/EHsc>
)
target_include_directories(ycode_ugrep_contract INTERFACE
  "${YCODE_UGREP_SOURCE_DIR}/include"
  "${YCODE_UGREP_SOURCE_DIR}/src"
  "${YCODE_VIIZ_SOURCE_DIR}"
)

target_link_libraries(ycode_reflex PRIVATE ycode_ugrep_contract pcre2-8-static)
target_link_libraries(ugrep PRIVATE
  ycode_ugrep_contract
  ycode_reflex
  ycode_viiz
  pcre2-8-static
  zlibstatic
  ycode_bzip2
  libzstd_static
  brotlienc
  brotlidec
  brotlicommon
)
target_link_options(ugrep PRIVATE /Brepro)
set_target_properties(ugrep PROPERTIES
  RUNTIME_OUTPUT_DIRECTORY "${YCODE_UGREP_OUTPUT_DIR}"
  RUNTIME_OUTPUT_DIRECTORY_RELEASE "${YCODE_UGREP_OUTPUT_DIR}"
)
