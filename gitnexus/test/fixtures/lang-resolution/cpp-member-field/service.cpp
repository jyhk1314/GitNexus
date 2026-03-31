#include "service.h"

void UserService::process() {
    m_user->persistUser();
    m_user->syncUserData();
}
