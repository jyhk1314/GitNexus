#pragma once

class Logger {
public:
    static void emitLogEntry(const char* msg);
    static Logger* getInstance();
};
