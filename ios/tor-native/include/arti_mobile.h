#ifndef ROBOSATS_ARTI_MOBILE_H
#define ROBOSATS_ARTI_MOBILE_H

#include <stdint.h>

#ifdef __cplusplus
extern "C" {
#endif

char *arti_mobile_version(void);
void arti_mobile_string_free(char *value);
int32_t arti_mobile_initialize(const char *data_directory);
uint8_t arti_mobile_bootstrap_progress(void);
char *arti_mobile_bootstrap_status(void);
int32_t arti_mobile_start_socks_proxy(uint16_t requested_port);
int32_t arti_mobile_stop_socks_proxy(void);
int32_t arti_mobile_destroy(void);
char *arti_mobile_last_error(void);

#ifdef __cplusplus
}
#endif

#endif
