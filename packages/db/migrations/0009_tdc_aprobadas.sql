-- TDC: todo lo que ya pasó por PCBM es tarjeta aprobada (en emboso, en ruta, devolución, entregada…), no "en
-- proceso". Las ventas ya cargadas se reclasifican igual que las nuevas (ver approvedIf / rejectedIf en
-- packages/core/src/campaigns.ts): primero el rechazo, después la aprobación. Lo que regresó a Talk
-- ("DEVOLUCION TALK AMERICA") sigue en proceso: no es tarjeta.
UPDATE bank_sales SET status_class = 'rechazado'
 WHERE campaign = 'tdc' AND status_class <> 'rechazado' AND status_raw LIKE '%RECHAZ%' AND status_raw NOT LIKE '%TALK%';

UPDATE bank_sales SET status_class = 'aprobado'
 WHERE campaign = 'tdc' AND status_class = 'en_proceso'
   AND status_raw NOT LIKE '%TALK%'
   AND (status_raw LIKE '%APROBAD%' OR status_raw LIKE '%ENTREG%' OR status_raw LIKE '%DEVOLU%' OR status_raw LIKE '%DEVUELT%'
        OR status_raw LIKE '%RUTA%' OR status_raw LIKE '%EMBOZ%' OR status_raw LIKE '%EMBOS%' OR status_raw LIKE '%DISTRIBU%');
