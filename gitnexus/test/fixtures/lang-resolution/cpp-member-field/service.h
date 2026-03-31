#pragma once
#include "user.h"

class UserService {
public:
    void process();
private:
    User* m_user;
};
