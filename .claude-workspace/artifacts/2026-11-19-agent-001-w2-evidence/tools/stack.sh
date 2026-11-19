#!/bin/sh
cd /Users/xavierau/Code/js/whatsapp-crm--agent-001
supabase start -x realtime,studio,imgproxy,edge-runtime,logflare,vector,mailpit,postgres-meta,supavisor > /private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/b7ce2348-be88-463f-a29e-8e4b78a7d232/scratchpad/w2/stack-start.log 2>&1
echo "start exit $?" >> /private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/b7ce2348-be88-463f-a29e-8e4b78a7d232/scratchpad/w2/stack-start.log
touch /private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/b7ce2348-be88-463f-a29e-8e4b78a7d232/scratchpad/w2/stack.ready
while [ ! -f /private/tmp/claude-501/-Users-xavierau-Code-js-whatsapp-crm/b7ce2348-be88-463f-a29e-8e4b78a7d232/scratchpad/w2/stop.sentinel ]; do sleep 5; done
