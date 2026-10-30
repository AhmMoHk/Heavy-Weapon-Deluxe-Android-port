import ctypes, ctypes.util
L = ctypes.CDLL('libopenmpt.so.0')
c_void_p = ctypes.c_void_p
L.openmpt_module_create_from_memory2.restype = c_void_p
L.openmpt_module_create_from_memory2.argtypes = [ctypes.c_void_p, ctypes.c_size_t, c_void_p, c_void_p, c_void_p, c_void_p, c_void_p, c_void_p, c_void_p]
for fn, rt, at in [
    ('openmpt_module_get_num_subsongs', ctypes.c_int32, [c_void_p]),
    ('openmpt_module_select_subsong', ctypes.c_int, [c_void_p, ctypes.c_int32]),
    ('openmpt_module_get_num_orders', ctypes.c_int32, [c_void_p]),
    ('openmpt_module_get_num_patterns', ctypes.c_int32, [c_void_p]),
    ('openmpt_module_get_num_channels', ctypes.c_int32, [c_void_p]),
    ('openmpt_module_get_order_pattern', ctypes.c_int32, [c_void_p, ctypes.c_int32]),
    ('openmpt_module_get_pattern_num_rows', ctypes.c_int32, [c_void_p, ctypes.c_int32]),
    ('openmpt_module_get_pattern_row_channel_command', ctypes.c_uint8, [c_void_p, ctypes.c_int32, ctypes.c_int32, ctypes.c_int32, ctypes.c_int]),
    ('openmpt_module_get_duration_seconds', ctypes.c_double, [c_void_p]),
    ('openmpt_module_set_position_order_row', ctypes.c_double, [c_void_p, ctypes.c_int32, ctypes.c_int32]),
    ('openmpt_module_get_current_order', ctypes.c_int32, [c_void_p]),
    ('openmpt_module_get_current_row', ctypes.c_int32, [c_void_p]),
    ('openmpt_module_get_position_seconds', ctypes.c_double, [c_void_p]),
    ('openmpt_module_set_repeat_count', ctypes.c_int, [c_void_p, ctypes.c_int32]),
    ('openmpt_module_read_interleaved_float_stereo', ctypes.c_size_t, [c_void_p, ctypes.c_int32, ctypes.c_size_t, ctypes.POINTER(ctypes.c_float)]),
    ('openmpt_module_get_subsong_name', ctypes.c_char_p, [c_void_p, ctypes.c_int32]),
    ('openmpt_module_ctl_set_text', ctypes.c_int, [c_void_p, ctypes.c_char_p, ctypes.c_char_p]),
    ('openmpt_module_set_render_param', ctypes.c_int, [c_void_p, ctypes.c_int, ctypes.c_int32]),
    ('openmpt_module_get_current_speed', ctypes.c_int32, [c_void_p]),
    ('openmpt_module_get_current_tempo', ctypes.c_int32, [c_void_p]),
]:
    f = getattr(L, fn); f.restype = rt; f.argtypes = at

def load(path):
    data = open(path, 'rb').read()
    buf = ctypes.create_string_buffer(data, len(data))
    m = L.openmpt_module_create_from_memory2(buf, len(data), None, None, None, None, None, None, None)
    assert m
    return m, buf
